/**
 * VaporNexus Kiosk Demo - app.js
 * Fully self-contained vanilla JS kiosk simulation.
 * - Loads products from products.json
 * - Complete customer flow: landing → ID scan → face verify → storefront → cart → checkout → success
 * - All data handling is in-memory / local demo only. No real payments, no network beyond static file fetch.
 * - Idle timeout + compliance status bar after verification.
 */

(() => {
  'use strict';

  // =====================
  // STATE
  // =====================
  let products = [];           // Loaded from products.json
  let cart = [];               // [{...product, qty: number}]
  let isIdVerified = false;
  let isFaceVerified = false;
  let currentView = 'landing';

  // Idle timeout (ms). Warning shown at 30s remaining.
  const IDLE_TIMEOUT_MS = 3 * 60 * 1000;      // 3 minutes
  const IDLE_WARNING_MS = 30 * 1000;          // show warning 30s before full reset
  let lastActivityTs = Date.now();
  let idleTimeoutId = null;
  let idleWarningTimeoutId = null;

  // Ohio State (5.75%) + Cuyahoga County (2.25%) combined sales tax for demo
  const TAX_RATE = 0.08;

  // =====================
  // DOM REFERENCES (cached after DOM ready)
  // =====================
  let dom = {};

  function cacheDom() {
    dom = {
      // Views
      views: {
        landing: document.getElementById('view-landing'),
        idScan: document.getElementById('view-id-scan'),
        faceVerify: document.getElementById('view-face-verify'),
        storefront: document.getElementById('view-storefront'),
        success: document.getElementById('view-success'),
      },

      // Header (visible after verification)
      header: document.getElementById('header'),
      statusBar: document.getElementById('status-bar'),
      cartBtn: document.getElementById('cart-btn'),

      // Landing
      startIdBtn: document.getElementById('start-id-btn'),

      // ID Scan
      idProgressContainer: document.getElementById('id-progress-container'),
      idProgressBar: document.getElementById('id-progress-bar'),
      idScanFrame: document.getElementById('id-scan-frame'),
      idResult: document.getElementById('id-result'),
      continueToFaceBtn: document.getElementById('continue-to-face-btn'),

      // Face Verify
      faceProgressContainer: document.getElementById('face-progress-container'),
      faceProgressBar: document.getElementById('face-progress-bar'),
      faceScanFrame: document.getElementById('face-scan-frame'),
      faceResult: document.getElementById('face-result'),
      continueToStoreBtn: document.getElementById('continue-to-store-btn'),

      // Storefront
      productGrid: document.getElementById('product-grid'),
      searchInput: document.getElementById('search-input'),
      categoryChips: document.getElementById('category-chips'),
      strengthChips: document.getElementById('strength-chips'),
      sortSelect: document.getElementById('sort-select'),
      priceMin: document.getElementById('price-min'),
      priceMax: document.getElementById('price-max'),
      clearFiltersBtn: document.getElementById('clear-filters-btn'),
      checkoutFloating: document.getElementById('checkout-floating'),

      // Cart drawer
      cartDrawer: document.getElementById('cart-drawer'),
      cartClose: document.getElementById('cart-close'),
      cartBody: document.getElementById('cart-body'),
      cartSubtotal: document.getElementById('cart-subtotal'),
      cartTax: document.getElementById('cart-tax'),
      cartTotal: document.getElementById('cart-total'),
      cartCount: document.getElementById('cart-count'),
      cartCheckoutBtn: document.getElementById('cart-checkout-btn'),
      clearCartBtn: document.getElementById('clear-cart-btn'),

      // Checkout (modal style or embedded panel)
      checkoutModal: document.getElementById('checkout-modal'),
      checkoutClose: document.getElementById('checkout-close'),
      orderSummary: document.getElementById('order-summary'),
      checkoutForm: document.getElementById('checkout-form'),
      payBtn: document.getElementById('pay-btn'),
      paymentError: document.getElementById('payment-error'),

      // Per-field checkout errors (for live blur validation)
      nameError: document.getElementById('cust-name-error'),
      emailError: document.getElementById('cust-email-error'),
      phoneError: document.getElementById('cust-phone-error'),
      cardNumberError: document.getElementById('card-number-error'),
      cardExpError: document.getElementById('card-exp-error'),
      cardCvvError: document.getElementById('card-cvv-error'),

      // Processing + Success
      processingView: document.getElementById('processing-view'),
      successTitle: document.getElementById('success-title'),
      receiptOptions: document.getElementById('receipt-options'),
      finalMessage: document.getElementById('final-message'),
      startNewBtn: document.getElementById('start-new-btn'),

      // Modals
      idleModal: document.getElementById('idle-modal'),
      idleContinueBtn: document.getElementById('idle-continue-btn'),
      idleEndBtn: document.getElementById('idle-end-btn'),

      // Toast container (created dynamically if needed)
      toast: null,
    };
  }

  // =====================
  // UTILITIES
  // =====================
  function showView(viewName) {
    currentView = viewName;

    // Hide all views
    Object.values(dom.views).forEach(v => v && v.classList.remove('active'));

    const target = dom.views[viewName];
    if (target) target.classList.add('active');

    // Show/hide persistent header + cart button after verification
    const verified = isIdVerified && isFaceVerified;
    if (dom.header) {
      dom.header.style.display = verified ? 'flex' : 'none';
    }

    // Update floating checkout visibility
    updateFloatingCheckout();

    // Reset idle timer when user moves to a meaningful new screen
    if (verified) resetIdleTimer();
  }

  function showToast(message, duration = 2200) {
    if (!dom.toast) {
      dom.toast = document.createElement('div');
      dom.toast.className = 'toast';
      document.body.appendChild(dom.toast);
    }
    dom.toast.textContent = message;
    dom.toast.classList.add('show');

    setTimeout(() => {
      if (dom.toast) dom.toast.classList.remove('show');
    }, duration);
  }

  function formatCurrency(amount) {
    return '$' + amount.toFixed(2);
  }

  function getUniqueValues(arr, key) {
    return [...new Set(arr.map(item => item[key]).filter(Boolean))];
  }

  function debounce(fn, wait = 180) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // =====================
  // IDLE TIMEOUT (Kiosk behavior)
  // =====================
  function resetIdleTimer() {
    if (!isIdVerified && !isFaceVerified) return;

    lastActivityTs = Date.now();

    // Clear existing timers
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    if (idleWarningTimeoutId) clearTimeout(idleWarningTimeoutId);

    // Schedule warning
    idleWarningTimeoutId = setTimeout(() => {
      showIdleWarningModal();
    }, IDLE_TIMEOUT_MS - IDLE_WARNING_MS);

    // Schedule full reset
    idleTimeoutId = setTimeout(() => {
      resetSession(true); // forced by idle
    }, IDLE_TIMEOUT_MS);
  }

  function showIdleWarningModal() {
    if (dom.idleModal) {
      dom.idleModal.classList.add('open');
      // Focus the continue button for kiosk accessibility
      setTimeout(() => dom.idleContinueBtn && dom.idleContinueBtn.focus(), 50);
    }
  }

  function hideIdleModal() {
    if (dom.idleModal) dom.idleModal.classList.remove('open');
  }

  function setupIdleListeners() {
    const activityEvents = ['click', 'touchstart', 'keydown', 'mousemove'];
    const handler = () => {
      if (isIdVerified || isFaceVerified) {
        resetIdleTimer();
      }
    };
    activityEvents.forEach(evt => {
      document.addEventListener(evt, handler, { passive: true });
    });
  }

  // =====================
  // VERIFICATION FLOW
  // =====================
  function startIdScan() {
    showView('idScan');

    // Reset scan UI
    dom.idProgressContainer.classList.remove('hidden');
    dom.idProgressBar.style.width = '0%';
    dom.idResult.classList.add('hidden');
    dom.idScanFrame.classList.remove('scanning');
    dom.continueToFaceBtn.classList.add('hidden');

    // Small delay then animate progress
    setTimeout(() => {
      dom.idScanFrame.classList.add('scanning');
      animateProgress(dom.idProgressBar, 100, 1650, () => {
        showIdResult();
      });
    }, 220);
  }

  function animateProgress(barEl, targetPercent, durationMs, onComplete) {
    const start = performance.now();
    const startWidth = parseFloat(barEl.style.width) || 0;

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const current = startWidth + (targetPercent - startWidth) * progress;
      barEl.style.width = current + '%';

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        onComplete && onComplete();
      }
    }
    requestAnimationFrame(step);
  }

  function showIdResult() {
    dom.idProgressContainer.classList.add('hidden');
    dom.idScanFrame.classList.remove('scanning');

    dom.idResult.innerHTML = `
      <div class="result-box success">
        <div class="result-title">ID verified — customer is 21+</div>
        <ul class="meta-list">
          <li>Age check passed (DOB on file indicates 21+)</li>
          <li>Document appears valid and unexpired</li>
          <li>Security features matched</li>
          <li>Session ID: VN-${Date.now().toString().slice(-8)}</li>
        </ul>
      </div>
    `;
    dom.idResult.classList.remove('hidden');
    dom.continueToFaceBtn.classList.remove('hidden');

    isIdVerified = true;
    updateStatusBar();
    resetIdleTimer();
  }

  function startFaceVerification() {
    showView('faceVerify');

    dom.faceProgressContainer.classList.remove('hidden');
    dom.faceProgressBar.style.width = '0%';
    dom.faceResult.classList.add('hidden');
    dom.faceScanFrame.classList.remove('scanning');
    dom.continueToStoreBtn.classList.add('hidden');

    setTimeout(() => {
      dom.faceScanFrame.classList.add('scanning');
      animateProgress(dom.faceProgressBar, 100, 1850, () => {
        showFaceResult();
      });
    }, 280);
  }

  function showFaceResult() {
    dom.faceProgressContainer.classList.add('hidden');
    dom.faceScanFrame.classList.remove('scanning');

    dom.faceResult.innerHTML = `
      <div class="result-box success">
        <div class="result-title">Face match confirmed</div>
        <ul class="meta-list">
          <li>Live face detected and matched to ID photo</li>
          <li>Confidence: 98.7%</li>
          <li>Liveness check passed (no photo/spoof detected)</li>
          <li>21+ status reconfirmed</li>
        </ul>
      </div>
    `;
    dom.faceResult.classList.remove('hidden');
    dom.continueToStoreBtn.classList.remove('hidden');

    isFaceVerified = true;
    updateStatusBar();
    resetIdleTimer();
  }

  function updateStatusBar() {
    if (!dom.statusBar) return;

    dom.statusBar.innerHTML = `
      <div class="status-pill verified">
        <span class="dot"></span>
        ID Verified
      </div>
      <div class="status-pill verified">
        <span class="dot"></span>
        Face Match Verified
      </div>
      <div class="status-pill verified">
        <span class="dot"></span>
        21+ Confirmed
      </div>
    `;
  }

  function enterStorefront() {
    showView('storefront');
    renderFilters();
    renderProducts(products);
    updateCartCount();
    updateFloatingCheckout();
  }

  // =====================
  // PRODUCTS + FILTERS + SORT
  // =====================
  async function loadProducts() {
    try {
      const res = await fetch('./products.json');
      if (!res.ok) throw new Error('Failed to load products.json');
      products = await res.json();
    } catch (e) {
      console.warn('Could not fetch products.json, using embedded fallback.', e);
      // Fallback so the demo still works even if served oddly
      products = getFallbackProducts();
    }
  }

  function getFallbackProducts() {
    // Robust fallback with 20 products. Used only if products.json fails to load.
    return [
      { id: 1, name: "Nexus Mini Pod", brand: "Nexus Labs", category: "Pod System", flavor: "Mint Chill", nicotineStrength: "6mg", price: 22.99, imageUrl: "https://images.pexels.com/photos/11112669/pexels-photo-11112669.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Slim all-day pod.", tags: ["featured"] },
      { id: 2, name: "Aether Disposable", brand: "Aether", category: "Disposable", flavor: "Blue Razz", nicotineStrength: "6mg", price: 12.49, imageUrl: "https://images.pexels.com/photos/3545426/pexels-photo-3545426.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Bold berry.", tags: ["bestseller"] },
      { id: 3, name: "Lumen Compact", brand: "Lumen Devices", category: "Pod System", flavor: "Mango Tango", nicotineStrength: "20mg", price: 26.49, imageUrl: "https://images.pexels.com/photos/20185329/pexels-photo-20185329.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Ergonomic pod with rich tropical mango.", tags: ["bestseller"] },
      { id: 4, name: "Frost Core 100", brand: "FrostForge", category: "E-Liquid", flavor: "Arctic Menthol", nicotineStrength: "20mg", price: 9.99, imageUrl: "https://images.pexels.com/photos/13749583/pexels-photo-13749583.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Clean, sharp menthol. 100ml premium base.", tags: ["featured"] },
      { id: 5, name: "Summit Box Mod", brand: "Summit", category: "Box Mod", flavor: "N/A", nicotineStrength: "6mg", price: 54.99, imageUrl: "https://images.pexels.com/photos/2463125/pexels-photo-2463125.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Dual 18650 high-wattage mod. 200W max.", tags: ["featured"] },
      { id: 6, name: "Pulse Bar", brand: "PulseVape", category: "Disposable", flavor: "Watermelon Ice", nicotineStrength: "18mg", price: 11.99, imageUrl: "https://images.pexels.com/photos/20552497/pexels-photo-20552497.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Crisp watermelon with icy exhale. 1800 puffs.", tags: [] },
      { id: 7, name: "Echo Pod Refill 4pk", brand: "Echo", category: "Pod Refill", flavor: "Vanilla Custard", nicotineStrength: "8mg", price: 16.99, imageUrl: "https://images.pexels.com/photos/13870386/pexels-photo-13870386.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Smooth custard flavor. Compatible with Echo devices.", tags: [] },
      { id: 8, name: "CloudBar Max", brand: "CloudBar", category: "Disposable", flavor: "Strawberry Kiwi", nicotineStrength: "35mg", price: 13.99, imageUrl: "https://images.pexels.com/photos/10967271/pexels-photo-10967271.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Sweet strawberry balanced with tart kiwi. 2200 puffs.", tags: [] },
      { id: 9, name: "VaporCore Pro", brand: "VaporCore", category: "Box Mod", flavor: "N/A", nicotineStrength: "18mg", price: 47.99, imageUrl: "https://images.pexels.com/photos/7230906/pexels-photo-7230906.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Single 21700 smart mod with color screen.", tags: ["featured"] },
      { id: 10, name: "Pure 60ml", brand: "Pure Labs", category: "E-Liquid", flavor: "Tobacco Reserve", nicotineStrength: "3mg", price: 8.49, imageUrl: "https://images.pexels.com/photos/1005486/pexels-photo-1005486.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Classic rich tobacco blend. 60ml bottle.", tags: [] },
      { id: 11, name: "Nexus XL Disposable", brand: "Nexus Labs", category: "Disposable", flavor: "Peach Mango", nicotineStrength: "50mg", price: 14.99, imageUrl: "https://images.pexels.com/photos/14289163/pexels-photo-14289163.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Juicy peach and mango. 3000 puff capacity.", tags: ["bestseller"] },
      { id: 12, name: "Aether Pod Kit", brand: "Aether", category: "Pod System", flavor: "Grape Ice", nicotineStrength: "32mg", price: 28.99, imageUrl: "https://images.pexels.com/photos/15288540/pexels-photo-15288540.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Premium MTL pod kit with airflow control.", tags: ["featured"] },
      { id: 13, name: "Berry Blast 100ml", brand: "Mist Labs", category: "E-Liquid", flavor: "Mixed Berry", nicotineStrength: "35mg", price: 10.99, imageUrl: "https://images.pexels.com/photos/15288749/pexels-photo-15288749.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Sweet and tart mixed berry medley.", tags: [] },
      { id: 14, name: "Forge Pod Refills 3pk", brand: "FrostForge", category: "Pod Refill", flavor: "Lemon Lime", nicotineStrength: "30mg", price: 14.99, imageUrl: "https://images.pexels.com/photos/13644949/pexels-photo-13644949.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Lemon Lime refills for Forge pods. 3-pack.", tags: [] },
      { id: 15, name: "Summit 80W", brand: "Summit", category: "Box Mod", flavor: "N/A", nicotineStrength: "35mg", price: 39.99, imageUrl: "https://images.pexels.com/photos/11284256/pexels-photo-11284256.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Reliable single-battery 80W box mod.", tags: ["bestseller"] },
      { id: 16, name: "Ice Pop Bar", brand: "PulseVape", category: "Disposable", flavor: "Blue Raspberry", nicotineStrength: "50mg", price: 12.99, imageUrl: "https://images.pexels.com/photos/1391451/pexels-photo-1391451.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Sweet blue raspberry popsicle flavor.", tags: [] },
      { id: 17, name: "Vanilla Silk 60ml", brand: "Pure Labs", category: "E-Liquid", flavor: "Vanilla Bean", nicotineStrength: "6mg", price: 9.49, imageUrl: "https://images.pexels.com/photos/7401265/pexels-photo-7401265.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Creamy Madagascar vanilla bean.", tags: ["featured"] },
      { id: 18, name: "Echo Pod Refills 3pk", brand: "Echo", category: "Pod Refill", flavor: "Coconut Rum", nicotineStrength: "20mg", price: 15.49, imageUrl: "https://images.pexels.com/photos/9746309/pexels-photo-9746309.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Coconut Rum refills for Echo pods. 3-pack.", tags: [] },
      { id: 19, name: "Lumen Max", brand: "Lumen Devices", category: "Box Mod", flavor: "N/A", nicotineStrength: "N/A", price: 62.99, imageUrl: "https://images.pexels.com/photos/4582463/pexels-photo-4582463.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Flagship 220W dual-battery touchscreen mod.", tags: ["featured"] },
      { id: 20, name: "Tropical Storm", brand: "CloudBar", category: "Disposable", flavor: "Pineapple Passion", nicotineStrength: "35mg", price: 13.49, imageUrl: "https://images.pexels.com/photos/10967463/pexels-photo-10967463.jpeg?auto=compress&cs=tinysrgb&w=400", shortDescription: "Vibrant pineapple and passionfruit blend.", tags: [] }
    ];
  }

  let activeFilters = {
    search: '',
    category: 'All',
    strength: 'Any',
    priceMin: 0,
    priceMax: 999,
    sort: 'featured'
  };

  function renderFilters() {
    // Category chips
    const categories = ['All', ...getUniqueValues(products, 'category')];
    dom.categoryChips.innerHTML = '';

    categories.forEach(cat => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeFilters.category === cat ? ' active' : '');
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        activeFilters.category = cat;
        renderFilters();
        applyFiltersAndRender();
      });
      dom.categoryChips.appendChild(chip);
    });

    // Strength chips (grouped ranges for touch friendliness)
    const strengthOptions = ['Any', '0-12mg', '15-24mg', '30+mg'];
    dom.strengthChips.innerHTML = '';

    strengthOptions.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeFilters.strength === opt ? ' active' : '');
      chip.textContent = opt;
      chip.addEventListener('click', () => {
        activeFilters.strength = opt;
        renderFilters();
        applyFiltersAndRender();
      });
      dom.strengthChips.appendChild(chip);
    });

    // Sort
    dom.sortSelect.value = activeFilters.sort;

    // Search (debounced)
    dom.searchInput.oninput = debounce(() => {
      activeFilters.search = dom.searchInput.value.trim().toLowerCase();
      applyFiltersAndRender();
    }, 140);

    // Price inputs
    dom.priceMin.value = activeFilters.priceMin || '';
    dom.priceMax.value = activeFilters.priceMax === 999 ? '' : activeFilters.priceMax;

    dom.priceMin.oninput = () => {
      activeFilters.priceMin = parseFloat(dom.priceMin.value) || 0;
      applyFiltersAndRender();
    };
    dom.priceMax.oninput = () => {
      activeFilters.priceMax = parseFloat(dom.priceMax.value) || 999;
      applyFiltersAndRender();
    };

    // Sort change
    dom.sortSelect.onchange = () => {
      activeFilters.sort = dom.sortSelect.value;
      applyFiltersAndRender();
    };

    // Clear filters
    dom.clearFiltersBtn.onclick = () => {
      activeFilters = { search: '', category: 'All', strength: 'Any', priceMin: 0, priceMax: 999, sort: 'featured' };
      dom.searchInput.value = '';
      renderFilters();
      applyFiltersAndRender();
    };
  }

  function matchesStrengthFilter(productStrength, filter) {
    if (filter === 'Any') return true;
    if (!productStrength || productStrength === 'N/A') return false;

    const num = parseFloat(productStrength);
    if (isNaN(num)) return false;

    if (filter === '0-12mg') return num <= 12;
    if (filter === '15-24mg') return num >= 15 && num <= 24;
    if (filter === '30+mg') return num >= 30;
    return true;
  }

  function applyFiltersAndRender() {
    let filtered = products.slice();

    // Search
    if (activeFilters.search) {
      const q = activeFilters.search;
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.flavor.toLowerCase().includes(q) ||
        (p.shortDescription || '').toLowerCase().includes(q)
      );
    }

    // Category
    if (activeFilters.category !== 'All') {
      filtered = filtered.filter(p => p.category === activeFilters.category);
    }

    // Strength
    if (activeFilters.strength !== 'Any') {
      filtered = filtered.filter(p => matchesStrengthFilter(p.nicotineStrength, activeFilters.strength));
    }

    // Price
    filtered = filtered.filter(p =>
      p.price >= activeFilters.priceMin && p.price <= activeFilters.priceMax
    );

    // Sort
    switch (activeFilters.sort) {
      case 'price-low':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'name-az':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'featured':
      default:
        // Featured first, then bestseller, then name
        filtered.sort((a, b) => {
          const aF = (a.tags || []).includes('featured') ? 0 : 1;
          const bF = (b.tags || []).includes('featured') ? 0 : 1;
          if (aF !== bF) return aF - bF;
          const aB = (a.tags || []).includes('bestseller') ? 0 : 1;
          const bB = (b.tags || []).includes('bestseller') ? 0 : 1;
          if (aB !== bB) return aB - bB;
          return a.name.localeCompare(b.name);
        });
        break;
    }

    renderProducts(filtered);
  }

  function renderProducts(list) {
    dom.productGrid.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.gridColumn = '1 / -1';
      empty.style.padding = '40px 20px';
      empty.style.textAlign = 'center';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'No products match your filters.';
      dom.productGrid.appendChild(empty);
      return;
    }

    list.forEach(product => {
      const card = document.createElement('div');
      card.className = 'product-card';

      const isFeatured = (product.tags || []).includes('featured');
      const isBestseller = (product.tags || []).includes('bestseller');

      card.innerHTML = `
        <div class="product-image-wrap">
          ${isFeatured ? '<span class="badge">Featured</span>' : ''}
          <img class="product-image" src="${product.imageUrl}" alt="${product.name}" loading="lazy" />
        </div>
        <div class="product-info">
          <div class="product-brand">${product.brand}</div>
          <h3 class="product-name">${product.name}</h3>
          <div class="product-meta">
            <span>${product.flavor}</span>
            <span>${product.nicotineStrength}</span>
            ${isBestseller ? '<span style="background:#3b2a6b;color:#c7b3ff;">Bestseller</span>' : ''}
          </div>
          <div class="product-desc">${product.shortDescription}</div>
          <div class="product-footer">
            <div class="product-price">${formatCurrency(product.price)}</div>
            <button class="add-btn" data-id="${product.id}">Add to Cart</button>
          </div>
        </div>
      `;

      // Add to cart handler
      const addBtn = card.querySelector('.add-btn');
      addBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        addToCart(product.id);
      });

      dom.productGrid.appendChild(card);
    });
  }

  // =====================
  // CART
  // =====================
  function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(item => item.id === productId);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ ...product, qty: 1 });
    }

    updateCartCount();
    updateFloatingCheckout();
    showToast(`${product.name} added to cart`);
    renderCart(); // refresh if drawer open

    // Persist lightly (demo convenience)
    try { localStorage.setItem('vn_cart', JSON.stringify(cart)); } catch (_) {}
  }

  function updateCartCount() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = getCartSubtotal();

    if (dom.cartBtn) {
      dom.cartBtn.innerHTML = `
        Cart
        <span class="count">${count}</span>
        <span style="color:var(--text-muted);font-weight:400;font-size:0.9rem;">${formatCurrency(subtotal)}</span>
      `;
    }

    // Enable/disable floating checkout
    updateFloatingCheckout();
  }

  function updateFloatingCheckout() {
    if (!dom.checkoutFloating) return;
    const count = cart.reduce((s, i) => s + i.qty, 0);
    if (count > 0 && currentView === 'storefront') {
      dom.checkoutFloating.style.display = 'inline-flex';
      dom.checkoutFloating.textContent = `Checkout (${count} items)`;
    } else {
      dom.checkoutFloating.style.display = 'none';
    }
  }

  function openCartDrawer() {
    renderCart();
    dom.cartDrawer.classList.add('open');
    resetIdleTimer();
  }

  function closeCartDrawer() {
    dom.cartDrawer.classList.remove('open');
  }

  function renderCart() {
    dom.cartBody.innerHTML = '';

    const subtotal = getCartSubtotal();
    const tax = getTaxAmount();
    const total = getCartTotal();

    if (cart.length === 0) {
      dom.cartBody.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:40px 10px;">Your cart is empty.</p>`;
      dom.cartSubtotal.textContent = formatCurrency(0);
      if (dom.cartTax) dom.cartTax.textContent = formatCurrency(0);
      if (dom.cartTotal) dom.cartTotal.textContent = formatCurrency(0);
      dom.cartCheckoutBtn.disabled = true;
      return;
    }

    cart.forEach(item => {
      const lineTotal = item.price * item.qty;

      const el = document.createElement('div');
      el.className = 'cart-item';
      el.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-meta">${item.brand} • ${item.flavor} • ${item.nicotineStrength}</div>
          <div class="cart-qty">
            <button class="qty-btn" data-action="dec" data-id="${item.id}">−</button>
            <span style="min-width:26px;text-align:center;font-weight:600;">${item.qty}</span>
            <button class="qty-btn" data-action="inc" data-id="${item.id}">+</button>
            <button class="remove-btn" data-action="remove" data-id="${item.id}">Remove</button>
          </div>
        </div>
        <div>
          <div class="cart-item-price">${formatCurrency(lineTotal)}</div>
        </div>
      `;

      // Bind qty / remove
      el.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const action = btn.dataset.action;

          if (action === 'inc') changeCartQty(id, 1);
          if (action === 'dec') changeCartQty(id, -1);
          if (action === 'remove') removeFromCart(id);
        });
      });

      dom.cartBody.appendChild(el);
    });

    dom.cartSubtotal.textContent = formatCurrency(subtotal);
    if (dom.cartTax) dom.cartTax.textContent = formatCurrency(tax);
    if (dom.cartTotal) dom.cartTotal.textContent = formatCurrency(total);
    dom.cartCheckoutBtn.disabled = false;
  }

  function changeCartQty(productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    item.qty += delta;
    if (item.qty < 1) item.qty = 1;

    renderCart();
    updateCartCount();
    try { localStorage.setItem('vn_cart', JSON.stringify(cart)); } catch (_) {}
  }

  function removeFromCart(productId) {
    cart = cart.filter(i => i.id !== productId);
    renderCart();
    updateCartCount();
    updateFloatingCheckout();
    try { localStorage.setItem('vn_cart', JSON.stringify(cart)); } catch (_) {}
  }

  function clearCart(confirmNeeded = true) {
    if (confirmNeeded && cart.length > 0) {
      if (!window.confirm('Clear all items from your cart?')) return;
    }
    cart = [];
    try { localStorage.removeItem('vn_cart'); } catch (_) {}
    renderCart();
    updateCartCount();
    updateFloatingCheckout();
    closeCartDrawer();
  }

  // =====================
  // CHECKOUT + PAYMENT
  // =====================
  function openCheckout() {
    if (cart.length === 0) return;

    closeCartDrawer();

    // Populate order summary
    let html = '';

    cart.forEach(item => {
      const line = item.price * item.qty;
      html += `
        <div class="summary-line">
          <span>${item.qty}× ${item.name} (${item.flavor})</span>
          <span>${formatCurrency(line)}</span>
        </div>
      `;
    });

    const subtotal = getCartSubtotal();
    const tax = getTaxAmount();
    const total = getCartTotal();

    html += `
      <div class="summary-line">
        <span>Subtotal</span>
        <span>${formatCurrency(subtotal)}</span>
      </div>
      <div class="summary-line" style="color:var(--text-subtle);font-size:0.9rem;">
        <span>Tax (Ohio State 5.75% + Cuyahoga County 2.25%)</span>
        <span>${formatCurrency(tax)}</span>
      </div>
      <div class="summary-line" style="font-weight:700;">
        <span>Total</span>
        <span>${formatCurrency(total)}</span>
      </div>
    `;

    dom.orderSummary.innerHTML = html;

    // Clear previous errors
    dom.paymentError.textContent = '';
    dom.paymentError.style.display = 'none';

    // Show modal
    dom.checkoutModal.classList.add('open');
    resetIdleTimer();

    // Focus first field
    setTimeout(() => {
      const first = dom.checkoutForm.querySelector('input');
      if (first) first.focus();
    }, 80);
  }

  function closeCheckout() {
    dom.checkoutModal.classList.remove('open');
  }

  function setupCheckoutForm() {
    // Card number restriction: max 4 digits, numbers only
    const cardInput = document.getElementById('card-number');
    if (cardInput) {
      cardInput.addEventListener('input', () => {
        // Strip non-digits and truncate to 4
        let val = cardInput.value.replace(/\D/g, '').slice(0, 4);
        cardInput.value = val;
      });
    }

    // Phone: format as (XXX) XXX-XXXX while typing (US 10-digit)
    const phoneInput = document.getElementById('cust-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        let digits = phoneInput.value.replace(/\D/g, '');
        if (digits.length > 10) digits = digits.slice(0, 10);
        if (digits.length > 6) {
          phoneInput.value = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
        } else if (digits.length > 3) {
          phoneInput.value = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
        } else if (digits.length > 0) {
          phoneInput.value = `(${digits}`;
        } else {
          phoneInput.value = '';
        }
      });
    }

    // Expiration: auto-format MM/YY
    const expInput = document.getElementById('card-exp');
    if (expInput) {
      expInput.addEventListener('input', () => {
        let digits = expInput.value.replace(/\D/g, '');
        if (digits.length > 4) digits = digits.slice(0, 4);
        if (digits.length > 2) {
          expInput.value = digits.slice(0, 2) + '/' + digits.slice(2);
        } else {
          expInput.value = digits;
        }
      });
    }

    // CVV: digits only, max 4 (supports Amex 4-digit CVV)
    const cvvInput = document.getElementById('card-cvv');
    if (cvvInput) {
      cvvInput.addEventListener('input', () => {
        cvvInput.value = cvvInput.value.replace(/\D/g, '').slice(0, 4);
      });
    }

    // --- Live per-field validation on blur (exit) + clear on focus ---
    // Name
    const nameInput = document.getElementById('cust-name');
    if (nameInput) {
      nameInput.addEventListener('blur', () => validateName(true));
      nameInput.addEventListener('focus', () => { if (dom.nameError) { dom.nameError.textContent = ''; dom.nameError.style.display = 'none'; } });
      nameInput.addEventListener('input', () => { if (dom.nameError && dom.nameError.textContent) { /* clear while correcting */ dom.nameError.textContent = ''; dom.nameError.style.display = 'none'; } });
    }

    // Email (show error quickly on exit after bad input, per user request)
    const emailInput = document.getElementById('cust-email');
    if (emailInput) {
      emailInput.addEventListener('blur', () => validateEmail(true));
      emailInput.addEventListener('focus', () => { if (dom.emailError) { dom.emailError.textContent = ''; dom.emailError.style.display = 'none'; } });
      emailInput.addEventListener('input', () => { if (dom.emailError && dom.emailError.textContent) { dom.emailError.textContent = ''; dom.emailError.style.display = 'none'; } });
    }

    // Phone
    const phoneInputLive = document.getElementById('cust-phone');
    if (phoneInputLive) {
      phoneInputLive.addEventListener('blur', () => validatePhone(true));
      phoneInputLive.addEventListener('focus', () => { if (dom.phoneError) { dom.phoneError.textContent = ''; dom.phoneError.style.display = 'none'; } });
      phoneInputLive.addEventListener('input', () => { if (dom.phoneError && dom.phoneError.textContent) { dom.phoneError.textContent = ''; dom.phoneError.style.display = 'none'; } });
    }

    // Card number (demo)
    const cardNumInput = document.getElementById('card-number');
    if (cardNumInput) {
      cardNumInput.addEventListener('blur', () => validateCardNumber(true));
      cardNumInput.addEventListener('focus', () => { if (dom.cardNumberError) { dom.cardNumberError.textContent = ''; dom.cardNumberError.style.display = 'none'; } });
      cardNumInput.addEventListener('input', () => { if (dom.cardNumberError && dom.cardNumberError.textContent) { dom.cardNumberError.textContent = ''; dom.cardNumberError.style.display = 'none'; } });
    }

    // Expiration
    const expInputLive = document.getElementById('card-exp');
    if (expInputLive) {
      expInputLive.addEventListener('blur', () => validateExpiration(true));
      expInputLive.addEventListener('focus', () => { if (dom.cardExpError) { dom.cardExpError.textContent = ''; dom.cardExpError.style.display = 'none'; } });
      expInputLive.addEventListener('input', () => { if (dom.cardExpError && dom.cardExpError.textContent) { dom.cardExpError.textContent = ''; dom.cardExpError.style.display = 'none'; } });
    }

    // CVV
    const cvvInputLive = document.getElementById('card-cvv');
    if (cvvInputLive) {
      cvvInputLive.addEventListener('blur', () => validateCvv(true));
      cvvInputLive.addEventListener('focus', () => { if (dom.cardCvvError) { dom.cardCvvError.textContent = ''; dom.cardCvvError.style.display = 'none'; } });
      cvvInputLive.addEventListener('input', () => { if (dom.cardCvvError && dom.cardCvvError.textContent) { dom.cardCvvError.textContent = ''; dom.cardCvvError.style.display = 'none'; } });
    }

    dom.checkoutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validateCheckoutForm()) {
        return;
      }
      handlePaymentAttempt();
    });

    dom.checkoutClose.addEventListener('click', closeCheckout);

    // Close on backdrop click
    dom.checkoutModal.addEventListener('click', (e) => {
      if (e.target === dom.checkoutModal) closeCheckout();
    });
  }

  // Individual field validators for live (blur) feedback.
  // Each shows a red message under its own field and returns true/false.
  function validateName(showMessage = true) {
    const input = document.getElementById('cust-name');
    const val = (input?.value || '').trim();
    const errorEl = dom.nameError;
    const regex = /^[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
    const valid = regex.test(val);

    if (errorEl) {
      if (!valid && showMessage && val.length > 0) {
        errorEl.textContent = 'Full name must include first and last name (hyphenated last names allowed).';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validateEmail(showMessage = true) {
    const input = document.getElementById('cust-email');
    const val = (input?.value || '').trim();
    const errorEl = dom.emailError;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid = regex.test(val);

    if (errorEl) {
      if (!valid && showMessage && val.length > 0) {
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validatePhone(showMessage = true) {
    const input = document.getElementById('cust-phone');
    const digits = (input?.value || '').replace(/\D/g, '');
    const errorEl = dom.phoneError;
    const valid = digits.length === 10;

    if (errorEl) {
      if (!valid && showMessage && digits.length > 0) {
        errorEl.textContent = 'Phone number must be a valid 10-digit US number.';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validateCardNumber(showMessage = true) {
    const input = document.getElementById('card-number');
    const digits = (input?.value || '').replace(/\D/g, '');
    const errorEl = dom.cardNumberError;
    const valid = digits.length === 4;

    if (errorEl) {
      if (!valid && showMessage && digits.length > 0) {
        errorEl.textContent = 'Card number must be exactly 4 digits for this demo.';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validateExpiration(showMessage = true) {
    const input = document.getElementById('card-exp');
    const val = (input?.value || '').trim();
    const errorEl = dom.cardExpError;
    const match = val.match(/^(\d{2})\/(\d{2})$/);
    let valid = false;
    if (match) {
      const month = parseInt(match[1], 10);
      valid = (month >= 1 && month <= 12);
    }

    if (errorEl) {
      if (!valid && showMessage && val.length > 0) {
        errorEl.textContent = 'Expiration must be MM/YY with valid month (01-12).';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validateCvv(showMessage = true) {
    const input = document.getElementById('card-cvv');
    const val = (input?.value || '').trim();
    const errorEl = dom.cardCvvError;
    const valid = /^\d{3,4}$/.test(val);

    if (errorEl) {
      if (!valid && showMessage && val.length > 0) {
        errorEl.textContent = 'CVV must be 3 or 4 digits (Amex uses 4).';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
    return valid;
  }

  function validateCheckoutForm() {
    // Run all per-field validators so errors appear under each box.
    const nameOk = validateName(true);
    const emailOk = validateEmail(true);
    const phoneOk = validatePhone(true);
    const cardNumOk = validateCardNumber(true);
    const expOk = validateExpiration(true);
    const cvvOk = validateCvv(true);

    const allValid = nameOk && emailOk && phoneOk && cardNumOk && expOk && cvvOk;

    const globalError = dom.paymentError;
    if (globalError) {
      globalError.textContent = '';
      globalError.style.display = 'none';
    }

    if (!allValid) {
      // Focus the first invalid field
      const firstBad = !nameOk ? 'cust-name' : !emailOk ? 'cust-email' : !phoneOk ? 'cust-phone' :
                       !cardNumOk ? 'card-number' : !expOk ? 'card-exp' : 'card-cvv';
      const el = document.getElementById(firstBad);
      if (el) el.focus();
      return false;
    }

    return true;
  }

  function handlePaymentAttempt() {
    const cardNumber = (document.getElementById('card-number')?.value || '').trim();
    const name = (document.getElementById('cust-name')?.value || '').trim();
    const email = (document.getElementById('cust-email')?.value || '').trim();
    const phone = (document.getElementById('cust-phone')?.value || '').trim();

    // Demo rule: only 1234 succeeds. Everything else is a friendly decline.
    const isApproved = cardNumber === '1234';

    // We never store or transmit the values.
    // Just close checkout and move to processing / result.

    closeCheckout();

    if (!isApproved) {
      // Friendly decline path - show message then allow retry or cancel
      showToast('Demo decline: Use card number 1234 to simulate approval.');
      // Re-open cart so user can try again easily
      setTimeout(() => {
        openCartDrawer();
      }, 900);
      return;
    }

    // Approved path
    simulatePaymentProcessing(name, email, phone);
  }

  function simulatePaymentProcessing(name, email, phone) {
    // Capture the final amount (with tax) before we clear the cart
    const paymentAmount = getCartTotal();

    // Clear the cart (and its localStorage persistence) immediately upon
    // successful payment. This must happen regardless of whether the user
    // ever clicks one of the receipt options ("Email", "Text", "Both", "No Receipt")
    // or just reloads the page.
    cart = [];
    try { localStorage.removeItem('vn_cart'); } catch (_) {}
    updateCartCount();

    // Switch to processing state inside success view area for simplicity
    showView('success'); // reuse the success container area
    dom.successTitle.textContent = '';
    dom.finalMessage.textContent = '';
    dom.receiptOptions.innerHTML = '';
    dom.startNewBtn.style.display = 'none';

    // Show processing inside the success view
    const processing = document.createElement('div');
    processing.id = 'temp-processing';
    processing.className = 'processing';
    processing.innerHTML = `
      <div class="spinner"></div>
      <div style="font-size:1.35rem;font-weight:700;margin-bottom:8px;">Processing payment...</div>
      <div style="color:var(--text-muted);">Authorizing • Dispensing preparation</div>
    `;
    const successScreen = dom.views.success;
    successScreen.appendChild(processing);

    setTimeout(() => {
      // Remove temp processing
      processing.remove();

      // Show success content
      dom.successTitle.textContent = 'Payment approved.';
      dom.finalMessage.innerHTML = `
        Payment of <strong>${formatCurrency(paymentAmount)}</strong> approved.<br>
        Dispensing queued for your items.
      `;

      // Receipt choices
      renderReceiptOptions(name, email, phone);

      dom.startNewBtn.style.display = 'inline-flex';
      dom.startNewBtn.onclick = () => resetSession();

      // Mark verified status still visible (header)
    }, 1850);
  }

  function getCartSubtotal() {
    return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  function getTaxAmount() {
    return getCartSubtotal() * TAX_RATE;
  }

  function getCartTotal() {
    return getCartSubtotal() + getTaxAmount();
  }

  function renderReceiptOptions(name, email, phone) {
    const container = dom.receiptOptions;
    container.innerHTML = '';

    const choices = [
      { label: 'Email', value: 'email' },
      { label: 'Text', value: 'text' },
      { label: 'Both', value: 'both' },
      { label: 'No Receipt', value: 'none' },
    ];

    choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'receipt-option';
      btn.textContent = choice.label;
      btn.addEventListener('click', () => {
        // Deselect siblings
        container.querySelectorAll('.receipt-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');

        handleReceiptChoice(choice.value, name, email, phone);
      });
      container.appendChild(btn);
    });
  }

  function handleReceiptChoice(choice, name, email, phone) {
    const msg = dom.finalMessage;
    let text = 'Thank you. Please collect your item when dispensing completes.';

    if (choice === 'email' && email) {
      text = `A receipt has been sent to ${email}. ${text}`;
    } else if (choice === 'text' && phone) {
      text = `A receipt has been texted to ${phone}. ${text}`;
    } else if (choice === 'both') {
      text = `Receipt sent by email${email ? ' to ' + email : ''} and text${phone ? ' to ' + phone : ''}. ${text}`;
    } else {
      text = `No receipt requested. ${text}`;
    }

    msg.innerHTML = text;

    // Disable receipt buttons after choice
    dom.receiptOptions.querySelectorAll('button').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.6';
    });

    // Auto show the start new session hint if not already
    dom.startNewBtn.style.display = 'inline-flex';
  }

  // =====================
  // SESSION RESET
  // =====================
  function resetSession(fromIdle = false) {
    // Clear state
    cart = [];
    isIdVerified = false;
    isFaceVerified = false;
    activeFilters = { search: '', category: 'All', strength: 'Any', priceMin: 0, priceMax: 999, sort: 'featured' };

    try { localStorage.removeItem('vn_cart'); } catch (_) {}

    // Clear timers
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    if (idleWarningTimeoutId) clearTimeout(idleWarningTimeoutId);
    hideIdleModal();

    // Reset UI elements
    if (dom.cartDrawer) dom.cartDrawer.classList.remove('open');
    if (dom.checkoutModal) dom.checkoutModal.classList.remove('open');
    if (dom.header) dom.header.style.display = 'none';
    if (dom.statusBar) dom.statusBar.innerHTML = '';

    // Reset any dynamic content
    if (dom.idResult) dom.idResult.innerHTML = '';
    if (dom.faceResult) dom.faceResult.innerHTML = '';
    if (dom.productGrid) dom.productGrid.innerHTML = '';

    // Back to landing
    showView('landing');

    if (fromIdle) {
      showToast('Session ended due to inactivity.');
    }
  }

  // =====================
  // EVENT WIRING
  // =====================
  function wireEvents() {
    // Landing
    dom.startIdBtn.addEventListener('click', startIdScan);

    // ID flow
    dom.continueToFaceBtn.addEventListener('click', startFaceVerification);

    // Face flow
    dom.continueToStoreBtn.addEventListener('click', enterStorefront);

    // Header cart button
    dom.cartBtn.addEventListener('click', openCartDrawer);
    dom.cartClose.addEventListener('click', closeCartDrawer);

    // Close cart on outside click (backdrop)
    dom.cartDrawer.addEventListener('click', (e) => {
      if (e.target === dom.cartDrawer) closeCartDrawer();
    });

    // Cart actions
    dom.cartCheckoutBtn.addEventListener('click', () => {
      closeCartDrawer();
      openCheckout();
    });
    dom.clearCartBtn.addEventListener('click', () => clearCart(true));

    // Floating checkout in storefront
    dom.checkoutFloating.addEventListener('click', openCheckout);

    // Idle modal actions
    dom.idleContinueBtn.addEventListener('click', () => {
      hideIdleModal();
      resetIdleTimer();
    });
    dom.idleEndBtn.addEventListener('click', () => {
      hideIdleModal();
      resetSession(true);
    });

    // Start new from success
    dom.startNewBtn.addEventListener('click', () => resetSession());

    // Keyboard escape support (nice for desktop demo)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.checkoutModal.classList.contains('open')) {
          closeCheckout();
        } else if (dom.cartDrawer.classList.contains('open')) {
          closeCartDrawer();
        } else if (dom.idleModal.classList.contains('open')) {
          hideIdleModal();
        }
      }
    });

    // Make sure clicking anywhere in main kiosk area resets idle when verified
    const kiosk = document.querySelector('.kiosk');
    if (kiosk) {
      kiosk.addEventListener('click', () => {
        if (isIdVerified || isFaceVerified) resetIdleTimer();
      }, { passive: true });
    }

    // Optional: restore light cart from localStorage for demo convenience (cleared on full reset)
    try {
      const saved = localStorage.getItem('vn_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) cart = parsed;
      }
    } catch (_) {}
  }

  // =====================
  // INITIALIZATION
  // =====================
  async function init() {
    cacheDom();
    wireEvents();
    setupCheckoutForm();
    setupIdleListeners();

    // Load products
    await loadProducts();

    // Start on landing
    showView('landing');

    // Optional: prefill a hint in search placeholder etc. (already in HTML)
    // Make the demo friendly on desktop too: allow pressing Enter in various places already wired.

    // Dev note: everything is client-side only.
    console.log('%c[VaporNexus] Demo initialized. All actions are simulated.', 'color:#5f6b85');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose a tiny debug hook (optional, harmless for demo)
  window.__VN_DEMO_RESET = () => resetSession();
})();