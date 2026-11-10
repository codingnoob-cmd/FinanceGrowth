/* FINANCE GROWTH — vanilla JavaScript application
   All records are stored locally in this browser. No bank connection or live market data is used. */
(() => {
  'use strict';

  const LEGACY_STORAGE_KEY = 'finance-growth-v1';
  const AUTH_STORAGE_KEY = 'finance-growth-local-profiles-v1';
  let STORAGE_KEY = LEGACY_STORAGE_KEY;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const today = () => { const date = new Date(); const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; };
  const monthKey = (date = today()) => String(date).slice(0, 7);
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `fg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const number = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const round2 = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const monthLabel = value => new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const currencySymbols = { AED: 'د.إ', USD: '$', EUR: '€', GBP: '£', INR: '₹', SAR: '﷼', PKR: '₨' };

  const freshState = () => ({
    version: 1,
    settings: { currency: 'AED', theme: 'light', font: 'manrope', textSize: 'normal', layout: 'comfortable', animations: true, reducedMotion: false, botanical: true, accent: '#245943', dashboardWidgets: { cashFlow: true, garden: true, recent: true, goals: true } },
    customExpenseCategories: [],
    accounts: [],
    transactions: [],
    budgets: [],
    goals: [],
    debts: [],
    debtPayments: [],
    investments: [],
    completedLessons: [],
    snapshots: []
  });

  let state = freshState();
  let activeUser = null;
  let authBusy = false;
  let authMode = 'signup';
  let currentView = 'dashboard';
  let activeCalculator = 'simple';
  let activeSettingsTab = 'appearance';
  let activeEducationFilter = 'All';
  let activeReportYear = String(new Date().getFullYear());

  function loadState(storageKey = STORAGE_KEY) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved || typeof saved !== 'object') return freshState();
      const base = freshState();
      return {
        ...base, ...saved,
        settings: { ...base.settings, ...(saved.settings || {}) },
        customExpenseCategories: Array.isArray(saved.customExpenseCategories) ? saved.customExpenseCategories : [],
        accounts: Array.isArray(saved.accounts) ? saved.accounts : [],
        transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
        budgets: Array.isArray(saved.budgets) ? saved.budgets : [],
        goals: Array.isArray(saved.goals) ? saved.goals : [],
        debts: Array.isArray(saved.debts) ? saved.debts : [],
        debtPayments: Array.isArray(saved.debtPayments) ? saved.debtPayments : [],
        investments: Array.isArray(saved.investments) ? saved.investments : [],
        completedLessons: Array.isArray(saved.completedLessons) ? saved.completedLessons : [],
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : []
      };
    } catch (error) {
      console.warn('Could not read local finance data:', error);
      return freshState();
    }
  }

  function persist() {
    if (!activeUser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      toast('Browser storage is full or unavailable. Export a backup and free some space.', 'error');
      console.error(error);
    }
  }

  function currentCurrency() { return state.settings.currency || 'AED'; }
  function money(value, currency = currentCurrency(), digits = 2) {
    const amount = number(value);
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    } catch (_) {
      return `${currencySymbols[currency] || currency} ${amount.toFixed(digits)}`;
    }
  }
  function sum(items, selector = item => item) { return items.reduce((total, item) => total + number(selector(item)), 0); }
  function activeCurrencyItems(items) { return items.filter(item => (item.currency || currentCurrency()) === currentCurrency()); }
  function accountBalance(account) {
    let balance = number(account.openingBalance);
    state.transactions.forEach(tx => {
      if (tx.currency !== account.currency) return;
      if (tx.accountId === account.id) {
        if (tx.type === 'income' || tx.type === 'refund') balance += number(tx.amount);
        if (tx.type === 'expense' || tx.type === 'transfer' || tx.type === 'investment') balance -= number(tx.amount);
      }
      if (tx.type === 'transfer' && tx.toAccountId === account.id) balance += number(tx.amount);
    });
    return round2(balance);
  }
  function accountTotals(currency = currentCurrency()) {
    const accounts = state.accounts.filter(account => account.currency === currency);
    return round2(sum(accounts, account => accountBalance(account)));
  }
  function monthTransactions(type, month = monthKey(), currency = currentCurrency()) {
    return state.transactions.filter(tx => tx.currency === currency && tx.date?.slice(0, 7) === month && tx.type === type);
  }
  function monthIncome(month = monthKey(), currency = currentCurrency()) { return sum(monthTransactions('income', month, currency), tx => tx.amount); }
  function monthExpenses(month = monthKey(), currency = currentCurrency()) { return sum(monthTransactions('expense', month, currency), tx => tx.amount) - sum(monthTransactions('refund', month, currency), tx => tx.amount); }
  function goalSavings(currency = currentCurrency()) { return sum(state.goals.filter(goal => goal.currency === currency), goal => goal.current); }
  function investmentTotals(currency = currentCurrency()) {
    const list = state.investments.filter(item => item.currency === currency);
    const contributed = round2(sum(list, item => item.contribution));
    const valuation = round2(sum(list, item => item.currentValue));
    return { contributed, valuation, change: round2(valuation - contributed) };
  }
  function debtTotals(currency = currentCurrency()) {
    const list = state.debts.filter(item => item.currency === currency);
    return { original: round2(sum(list, item => item.original)), remaining: round2(sum(list, item => item.remaining)) };
  }
  function assetTotals(currency = currentCurrency()) { return round2(accountTotals(currency) + investmentTotals(currency).valuation); }
  function netWorth(currency = currentCurrency()) { return round2(assetTotals(currency) - debtTotals(currency).remaining); }
  function addSnapshot() {
    const todayKey = today();
    const record = { date: todayKey, currency: currentCurrency(), assets: assetTotals(), liabilities: debtTotals().remaining, netWorth: netWorth() };
    const index = state.snapshots.findIndex(item => item.date === todayKey && item.currency === currentCurrency());
    if (index >= 0) state.snapshots[index] = record;
    else state.snapshots.push(record);
    if (state.snapshots.length > 500) state.snapshots = state.snapshots.slice(-500);
  }
  function commit(message, kind = 'success') {
    addSnapshot();
    persist();
    render();
    if (message) toast(message, kind);
  }

  const viewMeta = {
    dashboard: ['Dashboard', 'YOUR FINANCIAL OVERVIEW'], accounts: ['My accounts', 'KEEP EVERY ACCOUNT IN VIEW'], savings: ['Savings', 'GIVE YOUR PLANS ROOM TO GROW'],
    expenses: ['Expenses', 'UNDERSTAND WHERE YOUR MONEY GOES'], income: ['Income', 'SEE WHAT FLOWS INTO YOUR LIFE'], budgets: ['Budget planner', 'MAKE A PLAN THAT FEELS REALISTIC'],
    debts: ['Debt management', 'A CLEARER PATH TO LOWER BALANCES'], investments: ['Investments', 'TRACK WHAT YOU HAVE CONTRIBUTED'], goals: ['Financial goals', 'GIVE YOUR FUTURE A DIRECTION'],
    calculators: ['Calculators', 'MAKE THE NUMBERS EASIER TO UNDERSTAND'], education: ['Financial education', 'BUILD KNOWLEDGE, ONE IDEA AT A TIME'], reports: ['Reports & analytics', 'A CLEAR VIEW OF YOUR PROGRESS'], settings: ['Settings', 'MAKE THIS SPACE YOURS']
  };

  const currencyOptions = ['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'PKR'];
  const expenseCategories = ['Food', 'Transport', 'Shopping', 'Education', 'Entertainment', 'Bills', 'Healthcare', 'Housing', 'Debt repayment', 'Other'];
  const allExpenseCategories = () => [...new Set([...expenseCategories, ...(state.customExpenseCategories || [])])];
  const incomeCategories = ['Salary', 'Allowance', 'Freelance', 'Business', 'Gift', 'Other'];
  const accountTypes = ['Cash', 'Savings account', 'Current account', 'Personal account', 'Other asset'];
  const investmentCategories = ['Stocks', 'Funds / ETFs', 'Bonds', 'Property', 'Business', 'Other'];

  function options(items, selected, includeBlank = false) {
    return `${includeBlank ? '<option value="">Choose…</option>' : ''}${items.map(item => `<option value="${esc(item)}" ${String(item) === String(selected) ? 'selected' : ''}>${esc(item)}</option>`).join('')}`;
  }
  function accountOptions(selected, currency = currentCurrency()) {
    const accounts = state.accounts.filter(item => item.currency === currency);
    return accounts.length ? accounts.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)} · ${esc(item.currency)}</option>`).join('') : '<option value="">Create an account first</option>';
  }
  function field(label, name, value = '', type = 'text', placeholder = '', extra = '') {
    return `<label><span class="field-label">${label}</span><input class="field" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></label>`;
  }
  function selectField(label, name, list, selected, extra = '') {
    return `<label><span class="field-label">${label}</span><select class="select-field" name="${name}" ${extra}>${options(list, selected)}</select></label>`;
  }
  function textareaField(label, name, value = '', placeholder = '') {
    return `<label class="full"><span class="field-label">${label}</span><textarea class="textarea-field" name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
  }
  function intro(title, description, action = '') {
    return `<div class="page-intro"><div><h2>${title}</h2><p>${description}</p></div><div class="page-intro-actions">${action}</div></div>`;
  }
  function emptyState(title, description, button = '') {
    return `<div class="empty-state"><div class="empty-icon">✳</div><h4>${title}</h4><p>${description}</p>${button}</div>`;
  }
  function pageButton(label, action, primary = true, extra = '') {
    return `<button class="button ${primary ? 'button-primary' : 'button-quiet'}" data-action="${action}" ${extra}>${label}</button>`;
  }
  function actionButton(label, action, id, quiet = true) {
    return `<button class="button ${quiet ? 'button-quiet' : 'button-secondary'}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  }
  function tableRows(transactions, showActions = true) {
    if (!transactions.length) return `<tr><td colspan="6" class="muted">No transactions recorded yet.</td></tr>`;
    return transactions.map(tx => {
      const typeText = tx.type === 'transfer' ? 'Transfer' : tx.type === 'refund' ? 'Refund' : tx.type === 'investment' ? 'Investment movement' : tx.type[0].toUpperCase() + tx.type.slice(1);
      const account = state.accounts.find(item => item.id === tx.accountId);
      const destination = state.accounts.find(item => item.id === tx.toAccountId);
      const signed = tx.type === 'income' || tx.type === 'refund' ? '+' : tx.type === 'expense' ? '−' : '↔';
      const amountClass = tx.type === 'income' || tx.type === 'refund' ? 'amount-positive' : tx.type === 'expense' ? 'amount-negative' : '';
      const managed = Boolean(tx.relatedInvestmentId || tx.relatedDebtPaymentId);
      return `<tr data-search="${esc(`${tx.category} ${tx.note} ${account?.name || ''} ${typeText}`.toLowerCase())}">
        <td>${dateLabel(tx.date)}<span class="subcell">${esc(typeText)}</span></td>
        <td><strong>${esc(tx.category || typeText)}</strong><span class="subcell">${esc(tx.note || (tx.type === 'transfer' ? `${account?.name || 'Account'} → ${destination?.name || 'Account'}` : account?.name || 'No account'))}</span></td>
        <td>${esc(account?.name || '—')}</td>
        <td class="${amountClass}">${signed} ${money(tx.amount, tx.currency)}</td>
        <td>${esc(tx.paymentMethod || '—')}</td>
        <td>${showActions && !managed ? `<div class="table-actions"><button class="table-action" data-action="edit-transaction" data-id="${esc(tx.id)}" aria-label="Edit transaction">✎</button><button class="table-action" data-action="delete-transaction" data-id="${esc(tx.id)}" aria-label="Delete transaction">×</button></div>` : managed ? '<span class="tiny muted">Linked</span>' : ''}</td>
      </tr>`;
    }).join('');
  }

  function setTheme() {
    const s = state.settings;
    const supportedThemes = ['light','dark','green','emerald','forest'];
    const chosenTheme = s.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (supportedThemes.includes(s.theme) ? s.theme : 'light');
    document.body.dataset.theme = chosenTheme;
    document.body.classList.toggle('compact', s.layout === 'compact');
    document.body.classList.toggle('no-botany', s.botanical === false);
    document.body.classList.toggle('reduce-motion', s.reducedMotion || s.animations === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const safeAccent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#245943';
    document.body.style.setProperty('--emerald', safeAccent);
    document.body.style.setProperty('--accent', safeAccent);
    const widgets = s.dashboardWidgets || {};
    document.body.classList.toggle('hide-widget-cashflow', widgets.cashFlow === false);
    document.body.classList.toggle('hide-widget-garden', widgets.garden === false);
    document.body.classList.toggle('hide-widget-recent', widgets.recent === false);
    document.body.classList.toggle('hide-widget-goals', widgets.goals === false);
    document.body.classList.remove('font-inter', 'font-manrope', 'font-poppins', 'font-roboto', 'font-system', 'text-small', 'text-large');
    document.body.classList.add(`font-${s.font || 'manrope'}`);
    if (s.textSize === 'small' || s.textSize === 'large') document.body.classList.add(`text-${s.textSize}`);
  }

  function getLocalUsers() {
    try {
      const list = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '[]');
      return Array.isArray(list) ? list.filter(user => user && user.id && user.login && user.passwordHash && user.salt) : [];
    } catch (_) { return []; }
  }
  function saveLocalUsers(users) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(users));
  }
  function userStorageKey(userId) { return `finance-growth-profile-${userId}`; }
  function bytesToHex(bytes) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
  function hexToBytes(hex) { return new Uint8Array((hex.match(/.{1,2}/g) || []).map(pair => parseInt(pair, 16))); }
  async function passwordDigest(password, saltHex) {
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) throw new Error('Secure password hashing is unavailable in this browser. Please open the site in an up-to-date browser.');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return bytesToHex(bits);
  }
  function showAuth(mode = 'login', message = '', messageType = 'error') {
    authMode = mode;
    $('#authScreen').classList.remove('hidden');
    $('#welcomeScreen').classList.add('hidden');
    $('#appShell').classList.add('hidden');
    const users = getLocalUsers();
    const existing = users.length > 0;
    if (!existing && mode === 'login') authMode = 'signup';
    if (existing && mode === 'signup' && !users.length) authMode = 'signup';
    const signup = authMode === 'signup';
    $('#authCard').innerHTML = `
      <div class="auth-card-heading"><span class="auth-card-overline">${signup ? 'START YOUR FINANCIAL GARDEN' : 'WELCOME BACK'}</span><h2>${signup ? 'Create your account' : 'Sign in'}</h2><p>${signup ? 'Set up a personal profile on this device.' : 'Continue to your FINANCE GROWTH workspace.'}</p></div>
      <div class="auth-tabs" role="tablist" aria-label="Account access">
        <button type="button" class="auth-tab ${!signup?'active':''}" data-auth-mode="login" role="tab" aria-selected="${!signup}">Sign in</button>
        <button type="button" class="auth-tab ${signup?'active':''}" data-auth-mode="signup" role="tab" aria-selected="${signup}">Create account</button>
      </div>
      ${message ? `<div class="auth-message ${messageType === 'success' ? 'auth-message-success' : ''}" role="status">${esc(message)}</div>` : ''}
      <form id="${signup?'signupForm':'loginForm'}" class="auth-form" novalidate>
        ${signup ? `<label><span class="field-label">Your name</span><input class="field" name="displayName" type="text" autocomplete="name" placeholder="e.g. Alex Morgan" maxlength="60" required /></label>` : ''}
        <label><span class="field-label">Email or username</span><input class="field" name="login" type="text" autocomplete="${signup?'username':'username'}" placeholder="Enter your email or username" maxlength="120" required /></label>
        <label><span class="field-label">Password</span><input class="field" name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" placeholder="${signup?'At least 8 characters':'Your password'}" minlength="8" required /></label>
        ${signup ? `<label><span class="field-label">Confirm password</span><input class="field" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Enter your password again" minlength="8" required /></label>` : ''}
        <button class="button button-primary auth-submit" type="submit" ${authBusy?'disabled':''}>${authBusy?'Please wait…':signup?'Create account':'Sign in'} <span aria-hidden="true">→</span></button>
      </form>
      <div class="auth-local-note"><span>⌂</span><p><strong>Local account, no Google required.</strong><br/>Your profile and records stay in this browser. Use a unique password; this is not a cloud account and cannot sync across devices.</p></div>
      <p class="auth-account-hint">${signup?'Already have a profile?':'New to FINANCE GROWTH?'} <button type="button" data-auth-mode="${signup?'login':'signup'}">${signup?'Sign in':'Create an account'}</button></p>`;
  }
  function enterUser(user, migrateLegacy = false) {
    activeUser = { id: user.id, displayName: user.displayName || user.login, login: user.login };
    STORAGE_KEY = userStorageKey(user.id);
    if (migrateLegacy && !localStorage.getItem(STORAGE_KEY)) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) localStorage.setItem(STORAGE_KEY, legacy);
    }
    state = loadState(STORAGE_KEY);
    if (!state.snapshots.some(item => item.date === today() && item.currency === currentCurrency())) addSnapshot();
    persist();
    const initial = (activeUser.displayName || activeUser.login).trim().charAt(0).toUpperCase() || 'A';
    const avatar = $('#profileButton .profile-avatar');
    const name = $('#profileButton .profile-name');
    const menuAvatar = $('#profileMenuAvatar');
    const menuName = $('#profileMenuName');
    const menuLogin = $('#profileMenuLogin');
    if (avatar) avatar.textContent = initial;
    if (name) name.textContent = activeUser.displayName || activeUser.login;
    if (menuAvatar) menuAvatar.textContent = initial;
    if (menuName) menuName.textContent = activeUser.displayName || activeUser.login;
    if (menuLogin) menuLogin.textContent = activeUser.login;
    closeProfileMenu();
    showWelcome();
  }
  async function submitSignup(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const displayName = String(data.displayName || '').trim();
    const login = String(data.login || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (displayName.length < 2) return showAuth('signup', 'Please enter a name with at least two characters.');
    if (login.length < 3 || /\s/.test(login)) return showAuth('signup', 'Enter a valid email address or username without spaces.');
    if (password.length < 8) return showAuth('signup', 'Use a password with at least 8 characters.');
    if (password !== String(data.confirmPassword || '')) return showAuth('signup', 'Your passwords do not match.');
    const users = getLocalUsers();
    if (users.some(user => user.login.toLowerCase() === login)) return showAuth('signup', 'An account with that email or username already exists on this device.');
    authBusy = true;
    showAuth('signup');
    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const salt = bytesToHex(saltBytes);
      const passwordHash = await passwordDigest(password, salt);
      const user = { id: uid(), displayName, login, salt, passwordHash, createdAt: new Date().toISOString() };
      const firstProfile = users.length === 0;
      users.push(user);
      saveLocalUsers(users);
      authBusy = false;
      enterUser(user, firstProfile);
      toast('Your local profile is ready. Welcome to FINANCE GROWTH.');
    } catch (error) {
      authBusy = false;
      showAuth('signup', error.message || 'Could not create your local profile.');
    }
  }
  async function submitLogin(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const login = String(data.login || '').trim().toLowerCase();
    const password = String(data.password || '');
    const user = getLocalUsers().find(item => item.login.toLowerCase() === login);
    if (!user) return showAuth('login', 'No local account was found for that email or username.');
    authBusy = true;
    showAuth('login');
    try {
      const candidate = await passwordDigest(password, user.salt);
      if (candidate !== user.passwordHash) {
        authBusy = false;
        return showAuth('login', 'That password is incorrect. Please try again.');
      }
      authBusy = false;
      enterUser(user);
      toast(`Welcome back, ${user.displayName || user.login}.`);
    } catch (error) {
      authBusy = false;
      showAuth('login', error.message || 'Could not sign in.');
    }
  }
  function closeProfileMenu() {
    const menu = $('#profileMenu');
    const button = $('#profileButton');
    if (menu) menu.classList.add('hidden');
    if (button) button.setAttribute('aria-expanded', 'false');
  }
  function signOut() {
    // Save the current workspace, but never delete the profile or its records.
    persist();
    activeUser = null;
    state = freshState();
    STORAGE_KEY = LEGACY_STORAGE_KEY;
    currentView = 'dashboard';
    activeSettingsTab = 'appearance';
    activeCalculator = 'simple';
    closeProfileMenu();
    showAuth(getLocalUsers().length ? 'login' : 'signup', 'You have signed out. Sign in to your existing account or create a new account.', 'success');
  }
  function showWelcome() {
    $('#authScreen').classList.add('hidden');
    $('#welcomeScreen').classList.remove('hidden');
    $('#appShell').classList.add('hidden');
  }
  function showApp() {
    $('#authScreen').classList.add('hidden');
    $('#welcomeScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    setTheme();
    render();
  }

  function render() {
    setTheme();
    const meta = viewMeta[currentView] || viewMeta.dashboard;
    $('#pageTitle').textContent = meta[0];
    $('#topbarKicker').textContent = meta[1];
    $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === currentView));
    const renderer = {
      dashboard: renderDashboard, accounts: renderAccounts, savings: renderSavings, expenses: () => renderTransactions('expense'), income: () => renderTransactions('income'),
      budgets: renderBudgets, debts: renderDebts, investments: renderInvestments, goals: renderGoals, calculators: renderCalculators, education: renderEducation, reports: renderReports, settings: renderSettings
    }[currentView] || renderDashboard;
    $('#viewRoot').innerHTML = renderer();
    requestAnimationFrame(() => {
      if (currentView === 'dashboard') drawDashboardCharts();
      if (currentView === 'reports') drawReportCharts();
      if (currentView === 'expenses') drawExpenseChart();
    });
  }

  function plantSVG(score, kind = 'tree', label = '') {
    const level = score >= 1 ? 4 : score >= .75 ? 3 : score >= .45 ? 2 : score > 0 ? 1 : 0;
    const height = 180;
    const trunk = kind === 'flower' ? 'M100 153 C98 125 103 105 100 84' : 'M100 155 C96 125 105 93 100 58';
    const branches = kind === 'flower' ? 'M100 110 C82 98 74 88 68 72 M101 123 C118 110 126 98 132 84' : 'M100 118 C77 95 64 82 49 57 M101 103 C120 83 137 71 151 47 M100 91 C93 65 83 50 71 37';
    const leafPositions = [[49,57,-28],[71,37,-25],[151,47,30],[132,84,25],[68,72,-32],[84,79,15],[116,66,-14],[100,45,0],[37,79,-20],[162,73,25],[77,22,-20],[126,27,25]];
    const count = [0, 3, 6, 9, 12][level];
    const leaves = leafPositions.slice(0, count).map(([x,y,r], index) => `<ellipse class="plant-leaf" cx="${x}" cy="${y}" rx="${index % 3 === 0 ? 11 : 9}" ry="5.8" transform="rotate(${r} ${x} ${y})" fill="${index % 2 ? '#7f9b79' : '#a6bd94'}"/>`).join('');
    const flower = level === 4 && kind === 'flower' ? `<g fill="#d1b779"><circle cx="100" cy="73" r="5"/><ellipse cx="100" cy="62" rx="5" ry="9"/><ellipse cx="111" cy="73" rx="9" ry="5"/><ellipse cx="100" cy="84" rx="5" ry="9"/><ellipse cx="89" cy="73" rx="9" ry="5"/></g>` : '';
    return `<svg class="botanical-svg ${state.settings.animations && !state.settings.reducedMotion ? 'plant-growth' : ''}" viewBox="0 0 200 ${height}" role="img" aria-label="${esc(label || 'Plant growth illustration')}">
      <ellipse cx="100" cy="160" rx="58" ry="7" fill="#a4b39c" opacity=".26"/><path d="${trunk}" fill="none" stroke="#a88f65" stroke-width="7" stroke-linecap="round"/><path d="${branches}" fill="none" stroke="#a88f65" stroke-width="4.5" stroke-linecap="round"/>${leaves}${flower}
      <path d="M70 159 Q100 151 130 159" stroke="#78936f" stroke-width="2" fill="none"/><path d="M83 161v-7m34 7v-7" stroke="#78936f" stroke-width="1.5"/>
    </svg>`;
  }
  function savingsRatio() {
    const totalTargets = sum(state.goals.filter(item => item.currency === currentCurrency()), item => item.target);
    return totalTargets > 0 ? clamp(goalSavings() / totalTargets, 0, 1) : 0;
  }
  function debtRecoveryRatio() {
    const totals = debtTotals();
    return totals.original > 0 ? clamp((totals.original - totals.remaining) / totals.original, 0, 1) : 0;
  }
  function investmentsRatio() {
    const totals = investmentTotals();
    if (totals.contributed <= 0) return 0;
    // A restrained visual index: contributions establish the tree; manual valuation changes can nudge its stage.
    const contributionBase = clamp(totals.contributed / (totals.contributed + 2500), 0, 1) * 0.65;
    const valuationChange = clamp((totals.valuation - totals.contributed) / totals.contributed, -1, 1) * 0.2;
    return clamp(contributionBase + 0.2 + valuationChange, 0, 1);
  }
  function plantStage(score) { return score >= 1 ? 'Flourishing' : score >= .75 ? 'Thriving' : score >= .45 ? 'Developing' : score > 0 ? 'Taking root' : 'Ready to grow'; }

  function renderDashboard() {
    const currency = currentCurrency();
    const assets = assetTotals();
    const liabilities = debtTotals().remaining;
    const worth = netWorth();
    const income = monthIncome();
    const expenses = monthExpenses();
    const savings = goalSavings();
    const cashFlow = income - expenses;
    const upcomingDebts = state.debts.filter(debt => debt.currency === currency && debt.dueDate && debt.dueDate >= today() && debt.remaining > 0).sort((a,b) => a.dueDate.localeCompare(b.dueDate)).slice(0,3);
    const recent = [...state.transactions].filter(tx => tx.currency === currency).sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);
    const goals = state.goals.filter(goal => goal.currency === currency).slice(0,3);
    const txCount = state.transactions.filter(tx => tx.currency === currency).length;
    return `${`<div class="dashboard-banner"><div class="banner-copy"><p class="eyebrow">A MOMENT TO TAKE STOCK</p><h2>Your money has a story. <span style="color:#52745a">Let's grow it well.</span></h2><p>Start with what you know today. Every clear record makes the next decision easier.</p></div><div class="banner-garden"><svg viewBox="0 0 130 100" aria-hidden="true"><path d="M65 91V44M65 68C43 60 36 44 38 27c17 2 28 14 27 35m0-14c-1-22 12-36 31-40 3 20-8 34-31 40" fill="none" stroke="#64856a" stroke-width="4" stroke-linecap="round"/><path d="M27 91h78" stroke="#adbb9e" stroke-width="2"/><circle cx="39" cy="28" r="3" fill="#d0b87f"/><circle cx="96" cy="24" r="3" fill="#d0b87f"/></svg></div></div>`}
      <div class="grid grid-4">
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">◈</span> Total assets</div><div class="metric-value">${money(assets, currency)}</div><div class="metric-foot">Accounts + manually tracked investments</div></div>
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">⌁</span> Liabilities</div><div class="metric-value">${money(liabilities, currency)}</div><div class="metric-foot">Outstanding recorded debt</div></div>
        <div class="panel metric-card dark-panel"><div class="metric-label"><span class="metric-icon">✳</span> Net worth</div><div class="metric-value">${money(worth, currency)}</div><div class="metric-foot">Assets less liabilities · ${currency}</div></div>
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">♧</span> Savings tracked</div><div class="metric-value">${money(savings, currency)}</div><div class="metric-foot">Across ${state.goals.filter(g => g.currency === currency).length} active goals</div></div>
      </div>
      <div class="grid grid-4" style="margin-top:12px">
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">↗</span> Income this month</div><div class="metric-value">${money(income, currency)}</div><div class="metric-foot">${monthLabel(monthKey())}</div></div>
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">↘</span> Expenses this month</div><div class="metric-value">${money(expenses, currency)}</div><div class="metric-foot">Refunds reduce this total</div></div>
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">◉</span> Cash flow</div><div class="metric-value">${money(cashFlow, currency)}</div><div class="metric-foot ${cashFlow >= 0 ? 'positive' : 'negative'}">Income minus expenses</div></div>
        <div class="panel metric-card"><div class="metric-label"><span class="metric-icon">▣</span> Account balance</div><div class="metric-value">${money(accountTotals(), currency)}</div><div class="metric-foot">${state.accounts.filter(a => a.currency === currency).length} accounts · ${currency}</div></div>
      </div>
      <div class="dashboard-lower">
        <section class="panel chart-panel" id="cashFlowPanel"><div class="panel-title-row"><div><h3>Cash flow overview</h3><p>Recorded income and expenses across the last six months</p></div><span class="pill">${currency}</span></div><div class="chart-wrap"><canvas id="cashFlowChart" aria-label="Cash flow line chart"></canvas></div><div class="legend-row"><span class="legend-item"><i class="legend-dot"></i> Income</span><span class="legend-item"><i class="legend-dot gold-dot"></i> Expenses</span></div></section>
        <section class="panel garden-panel" id="gardenPanel"><div class="garden-top"><div><h3>My financial garden</h3><p>Plants respond to your saved records</p></div><span class="pill gold">LIVE FROM YOUR DATA</span></div><div class="garden-art">${plantSVG(savingsRatio(), 'tree', 'Your Money Tree')}</div><div class="garden-plant-list">
          <div class="plant-mini"><strong>Money Tree <span class="plant-status">♧</span></strong><span>${plantStage(savingsRatio())}</span></div>
          <div class="plant-mini"><strong>Recovery Plant <span class="plant-status">✳</span></strong><span>${plantStage(debtRecoveryRatio())}</span></div>
          <div class="plant-mini"><strong>Investment Tree <span class="plant-status">♢</span></strong><span>${state.investments.length ? plantStage(investmentsRatio()) : 'Ready to grow'}</span></div>
          <div class="plant-mini"><strong>Knowledge Plant <span class="plant-status">⌁</span></strong><span>${state.completedLessons.length} lessons completed</span></div>
        </div></section>
      </div>
      <div class="grid grid-2 dashboard-chart-row">
        <section class="panel chart-panel"><div class="panel-title-row"><div><h3>Where your money goes</h3><p>Expense categories this month · ${currency}</p></div><span class="pill">PIE</span></div><div class="chart-visual-split"><div class="chart-wrap chart-wrap-square"><canvas id="dashboardExpenseMix" aria-label="Doughnut chart showing monthly expense categories"></canvas></div><div class="chart-legend-list" id="dashboardExpenseLegend"></div></div></section>
        <section class="panel chart-panel" id="monthlyBarsPanel"><div class="panel-title-row"><div><h3>Monthly comparison</h3><p>Income and expenses · last six months</p></div><span class="pill">BAR</span></div><div class="chart-wrap"><canvas id="dashboardMonthlyBars" aria-label="Bar chart comparing monthly income and expenses"></canvas></div><div class="legend-row"><span class="legend-item"><i class="legend-dot"></i> Income</span><span class="legend-item"><i class="legend-dot gold-dot"></i> Expenses</span></div></section>
      </div>
      <div class="dashboard-bottom">
        <section class="panel table-panel" id="recentPanel"><div class="panel-title-row"><div><h3>Recent activity</h3><p>${txCount ? 'Your latest recorded transactions' : 'Your activity will appear here'}</p></div><button class="text-link" data-action="go-transactions">View all →</button></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Activity</th><th>Account</th><th>Amount</th><th>Method</th><th></th></tr></thead><tbody>${tableRows(recent)}</tbody></table></div>${!recent.length ? `<div class="small muted" style="padding:12px 8px">Add your first transaction to see your cash flow take shape.</div>` : ''}</section>
        <section class="panel table-panel" id="goalsPanel"><div class="panel-title-row"><div><h3>Goals & upcoming payments</h3><p>A few things to keep in view</p></div><button class="text-link" data-action="navigate-goals">View goals →</button></div>
          ${goals.length ? goals.map(goal => `<div class="goal-row"><div class="goal-row-top"><strong>${esc(goal.name)}</strong><span>${Math.round(goal.target ? goal.current / goal.target * 100 : 0)}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${clamp(goal.target ? goal.current / goal.target * 100 : 0,0,100)}%"></div></div><div class="goal-meta"><span>${money(goal.current, goal.currency)} saved</span><span>${money(goal.target, goal.currency)} target</span></div></div>`).join('') : `<p class="small muted">No goals yet. Create one to give your savings a direction.</p>`}
          <div class="divider"></div><strong class="small">Upcoming debt due dates</strong>
          ${upcomingDebts.length ? upcomingDebts.map(debt => `<div class="goal-row"><div class="goal-row-top"><strong>${esc(debt.name)}</strong><span>${dateLabel(debt.dueDate)}</span></div><div class="goal-meta"><span>Minimum payment</span><span>${money(debt.minimumPayment, debt.currency)}</span></div></div>`).join('') : `<p class="small muted" style="margin:7px 0 0">No upcoming debt dates recorded.</p>`}
        </section>
      </div>`;
  }

  function renderAccounts() {
    const currency = currentCurrency();
    const accounts = state.accounts.filter(item => item.currency === currency);
    const total = accountTotals(currency);
    const action = `${pageButton('＋ Add account', 'add-account')}${pageButton('Transfer money', 'add-transfer', false, accounts.length < 2 ? 'disabled title="Create two accounts in the same currency first"' : '')}`;
    const cards = accounts.map(account => `<article class="panel account-card"><div class="account-type-icon">${account.type === 'Cash' ? '◉' : account.type.includes('Savings') ? '♧' : '▣'}</div><h3>${esc(account.name)}</h3><span class="pill gray">${esc(account.type)}</span><div class="account-balance">${money(accountBalance(account), currency)}</div><div class="account-meta">Opening balance: ${money(account.openingBalance, currency)}</div><div class="card-foot"><span class="small muted">${esc(account.description || 'No description')}</span><div class="table-actions"><button class="table-action" data-action="edit-account" data-id="${esc(account.id)}" aria-label="Edit account">✎</button><button class="table-action" data-action="delete-account" data-id="${esc(account.id)}" aria-label="Delete account">×</button></div></div></article>`).join('');
    return `${intro('Give every balance a home', `Track cash and accounts separately. Balances are calculated from the opening amount and the transactions you record. All figures below are in ${currency}.`, action)}
      <div class="grid grid-3" style="margin-bottom:15px"><div class="panel metric-card"><div class="metric-label">Total account balance</div><div class="metric-value">${money(total,currency)}</div><div class="metric-foot">${accounts.length} accounts</div></div><div class="panel metric-card"><div class="metric-label">Transactions recorded</div><div class="metric-value">${state.transactions.filter(tx => tx.currency === currency).length}</div><div class="metric-foot">Across this currency</div></div><div class="panel metric-card"><div class="metric-label">Transfer treatment</div><div class="metric-value">No double count</div><div class="metric-foot">Transfers change balances, not income or expenses</div></div></div>
      ${accounts.length ? `<div class="grid grid-3">${cards}</div>` : emptyState('Your account space is ready', 'Add an account to begin organizing your cash and balances.', pageButton('＋ Create first account', 'add-account'))}
      <div class="section-heading"><div><h3>Account activity</h3><p>Income, expenses, refunds and transfers linked to your accounts</p></div></div>
      <section class="panel table-panel"><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Activity</th><th>Account</th><th>Amount</th><th>Method</th><th></th></tr></thead><tbody>${tableRows(state.transactions.filter(tx => tx.currency === currency).sort((a,b) => b.date.localeCompare(a.date)).slice(0,12))}</tbody></table></div></section>`;
  }

  function renderSavings() {
    const currency = currentCurrency();
    const goals = state.goals.filter(goal => goal.currency === currency);
    const saved = goalSavings(currency);
    const target = sum(goals, goal => goal.target);
    const ratio = target ? clamp(saved / target, 0, 1) : 0;
    const remaining = Math.max(0, target - saved);
    return `${intro('Cultivate your money tree', 'A savings workspace for the things you are building toward. Contributions here track progress toward a goal; they do not move money between accounts.', pageButton('＋ Add savings goal', 'add-goal'))}
      <div class="feature-split"><section class="panel savings-feature"><p class="eyebrow" style="color:#c4d0bd">YOUR MONEY TREE</p><h2>${plantStage(ratio)}.</h2><p>Your tree reflects recorded savings contributions against your goals.</p><div class="savings-total">${money(saved,currency)}</div><div class="savings-stats"><div><span>TOTAL TARGET</span><strong>${money(target,currency)}</strong></div><div><span>TO GO</span><strong>${money(remaining,currency)}</strong></div><div><span>PROGRESS</span><strong>${Math.round(ratio*100)}%</strong></div></div><div class="progress-track" style="background:rgba(255,255,255,.15);margin-top:17px"><div class="progress-fill gold-fill" style="width:${ratio*100}%;background:#d4bd88"></div></div></section><section class="panel savings-tree-panel">${plantSVG(ratio,'tree','Savings money tree')}<span class="plant-stage-label">${plantStage(ratio).toUpperCase()} · ${Math.round(ratio*100)}% OF ALL TARGETS</span></section></div>
      <div class="section-heading"><div><h3>Your savings goals</h3><p>Each goal grows from the contributions you record</p></div></div>
      ${goals.length ? `<div class="grid grid-3">${goals.map(goal => goalCard(goal)).join('')}</div>` : emptyState('Plant your first savings goal', 'Choose something meaningful to save toward, then add contributions as you go.', pageButton('Create a savings goal', 'add-goal'))}
      <div class="section-heading"><div><h3>Savings notes</h3><p>Keep targets realistic and review them as life changes</p></div></div>
      <div class="panel panel-pad"><p class="small muted" style="margin:0;line-height:1.8">Savings goal contributions are a planning record, not an additional bank balance. Your actual cash and account balances are calculated separately in <strong>My accounts</strong>. This separation helps avoid counting the same money twice.</p></div>
      <div class="section-heading"><div><h3>Recent savings contributions</h3><p>Entries recorded across your goals</p></div></div><section class="panel table-panel"><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Goal</th><th>Note</th><th>Contribution</th></tr></thead><tbody>${goals.flatMap(goal=>(goal.history||[]).map(entry=>({...entry,goalName:goal.name,currency:goal.currency}))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(entry=>`<tr><td>${dateLabel(entry.date)}</td><td>${esc(entry.goalName)}</td><td>${esc(entry.note||'—')}</td><td class="amount-positive">+ ${money(entry.amount,entry.currency)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No contributions recorded yet.</td></tr>'}</tbody></table></div></section>`;
  }
  function goalEstimatedCompletion(goal) {
    const entries=(goal.history||[]).filter(item=>number(item.amount)>0&&item.date).sort((a,b)=>a.date.localeCompare(b.date));
    if(entries.length<2)return '';
    const first=new Date(`${entries[0].date}T00:00:00`),last=new Date(`${entries[entries.length-1].date}T00:00:00`);
    const elapsedMonths=(last-first)/(1000*60*60*24*30.4375);
    if(elapsedMonths<1||goal.current>=goal.target)return '';
    const monthly=sum(entries,item=>item.amount)/elapsedMonths;
    if(monthly<=0)return '';
    const monthsNeeded=Math.ceil((goal.target-goal.current)/monthly);
    const finish=new Date();finish.setMonth(finish.getMonth()+monthsNeeded);
    const finishDate=`${finish.getFullYear()}-${String(finish.getMonth()+1).padStart(2,'0')}-01`;
    return `Estimated at recent pace: ${monthLabel(finishDate)}`;
  }
  function goalCard(goal) {
    const ratio = goal.target ? clamp(goal.current / goal.target, 0, 1) : 0;
    const estimated = goalEstimatedCompletion(goal);
    return `<article class="panel goal-card"><div class="goal-card-head"><div class="goal-flower">${ratio >= 1 ? '✿' : '❀'}</div><div style="display:flex;align-items:center;gap:6px"><button class="table-action" data-action="goal-history" data-id="${esc(goal.id)}" aria-label="View contribution history">◷</button><span class="pill ${ratio >= 1 ? 'gold' : ''}">${ratio >= 1 ? 'Target reached' : `${Math.round(ratio*100)}%`}</span></div></div><h3>${esc(goal.name)}</h3><p>${esc(goal.description || 'A goal worth growing toward')}</p><div class="goal-amount">${money(goal.current,goal.currency)}</div><div class="progress-track"><div class="progress-fill" style="width:${ratio*100}%"></div></div><div class="goal-meta"><span>${money(goal.current,goal.currency)} saved</span><span>${money(goal.target,goal.currency)} target</span></div><div class="goal-meta"><span>${goal.targetDate ? `Target: ${dateLabel(goal.targetDate)}` : 'No target date'}</span><span>${money(Math.max(0,goal.target-goal.current),goal.currency)} remaining</span></div>${estimated?`<div class="tiny muted" style="margin-top:7px">${esc(estimated)}</div>`:''}<div class="card-bottom-actions"><button class="button button-primary" data-action="contribute-goal" data-id="${esc(goal.id)}">＋ Contribute</button><button class="button button-quiet" data-action="edit-goal" data-id="${esc(goal.id)}">Edit</button><button class="button button-quiet" data-action="delete-goal" data-id="${esc(goal.id)}">×</button></div></article>`;
  }

  function renderTransactions(type) {
    const currency = currentCurrency();
    const isExpense = type === 'expense';
    const title = isExpense ? 'Bring your spending into focus' : 'Understand what flows in';
    const description = isExpense ? 'Record expenses and refunds, categorize them, and spot patterns over time.' : 'Keep a clear record of salary, allowances, freelance work, gifts and other income.';
    const txs = state.transactions.filter(tx => tx.currency === currency && (isExpense ? ['expense','refund'].includes(tx.type) : tx.type === 'income')).sort((a,b) => b.date.localeCompare(a.date));
    const total = isExpense ? monthExpenses() : monthIncome();
    const cats = isExpense ? expenseCategories : incomeCategories;
    const byCategory = {};
    txs.filter(tx => tx.date.slice(0,7) === monthKey()).forEach(tx => { byCategory[tx.category] = (byCategory[tx.category] || 0) + (tx.type === 'refund' ? -number(tx.amount) : number(tx.amount)); });
    const categoryRows = Object.entries(byCategory).sort((a,b) => b[1]-a[1]);
    return `${intro(title, description, pageButton(`＋ Add ${isExpense ? 'expense' : 'income'}`, isExpense ? 'add-expense' : 'add-income'))}
      <div class="grid grid-3" style="margin-bottom:14px"><div class="panel metric-card"><div class="metric-label">${isExpense ? 'Expenses' : 'Income'} this month</div><div class="metric-value">${money(total,currency)}</div><div class="metric-foot">${monthLabel(monthKey())}</div></div><div class="panel metric-card"><div class="metric-label">Records this year</div><div class="metric-value">${txs.filter(tx => tx.date.startsWith(String(new Date().getFullYear()))).length}</div><div class="metric-foot">Saved transaction records</div></div><div class="panel metric-card"><div class="metric-label">Categories used this month</div><div class="metric-value">${categoryRows.length}</div><div class="metric-foot">Based on entries recorded this month</div></div></div>
      ${isExpense ? `<div class="grid grid-3 expense-chart-grid" style="margin-bottom:14px"><section class="panel panel-pad"><div class="panel-title-row"><div><h3>Spending by category</h3><p>This month · refunds reduce the category total</p></div></div><div id="expenseCategoryBars" style="margin-top:15px">${categoryRows.length ? categoryRows.map(([name,value]) => `<div style="margin:11px 0"><div class="goal-row-top"><strong>${esc(name)}</strong><span>${money(value,currency)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${clamp(value / Math.max(1,...categoryRows.map(row => row[1]))*100,0,100)}%"></div></div></div>`).join('') : '<p class="small muted">No spending recorded this month.</p>'}</div></section><section class="panel chart-panel"><div class="panel-title-row"><div><h3>Category mix</h3><p>Monthly expense distribution</p></div><span class="pill">PIE</span></div><div class="chart-wrap chart-wrap-square"><canvas id="expenseCategoryPie" aria-label="Pie chart showing expenses by category"></canvas></div><div class="chart-legend-list chart-legend-grid" id="expenseCategoryLegend"></div></section><section class="panel chart-panel"><div class="panel-title-row"><div><h3>Spending trend</h3><p>Monthly expenses over the last six months</p></div><span class="pill">LINE</span></div><div class="chart-wrap"><canvas id="expenseTrendChart" aria-label="Expense trend"></canvas></div></section></div>` : ''}
      <section class="panel"><div class="toolbar"><input class="field search-input" id="transactionSearch" type="search" placeholder="Search transactions…" aria-label="Search transactions" /><select class="select-small" id="transactionMonth"><option value="all">All months</option>${Array.from({length:12},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-i);const m=monthKey(d.toISOString().slice(0,10));return `<option value="${m}">${monthLabel(m)}</option>`}).join('')}</select><select class="select-small" id="transactionYear"><option value="all">All years</option>${[...new Set([String(new Date().getFullYear()),...state.transactions.map(tx=>tx.date.slice(0,4))])].sort((a,b)=>b.localeCompare(a)).map(year=>`<option value="${year}">${year}</option>`).join('')}</select><span class="pill">${txs.length} records · ${currency}</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Category / note</th><th>Account</th><th>Amount</th><th>Method</th><th>Actions</th></tr></thead><tbody id="transactionRows">${tableRows(txs)}</tbody></table></div></section>`;
  }

  function renderBudgets() {
    const currency = currentCurrency();
    const budgets = state.budgets.filter(item => item.currency === currency).sort((a,b) => b.month.localeCompare(a.month));
    const thisMonth = budgets.filter(item => item.month === monthKey());
    const spentFor = budget => state.transactions.filter(tx => tx.currency === budget.currency && tx.type === 'expense' && tx.category === budget.category && tx.date.slice(0,7) === budget.month).reduce((sum, tx) => sum + number(tx.amount), 0) - state.transactions.filter(tx => tx.currency === budget.currency && tx.type === 'refund' && tx.category === budget.category && tx.date.slice(0,7) === budget.month).reduce((sum, tx) => sum + number(tx.amount), 0);
    const totalLimit = sum(thisMonth, item => item.limit);
    const totalSpent = sum(thisMonth, spentFor);
    return `${intro('A plan for every part of your life', 'Set category limits for a month and compare them with your recorded expenses. Transfers are never included in spending.', pageButton('＋ Create budget', 'add-budget'))}
      <div class="grid grid-3" style="margin-bottom:15px"><div class="panel metric-card"><div class="metric-label">Planned this month</div><div class="metric-value">${money(totalLimit,currency)}</div><div class="metric-foot">${thisMonth.length} category budgets</div></div><div class="panel metric-card"><div class="metric-label">Recorded spending</div><div class="metric-value">${money(totalSpent,currency)}</div><div class="metric-foot">Expenses less refunds</div></div><div class="panel metric-card"><div class="metric-label">Budget remaining</div><div class="metric-value">${money(totalLimit-totalSpent,currency)}</div><div class="metric-foot ${totalLimit>=totalSpent?'positive':'negative'}">${totalLimit >= totalSpent ? 'Within planned total' : 'Over planned total'}</div></div></div>
      ${thisMonth.length ? `<div class="grid grid-2">${thisMonth.map(item => {const spent=spentFor(item);const ratio=item.limit>0?spent/item.limit:0;return `<article class="panel panel-pad"><div class="panel-title-row"><div><h3>${esc(item.category)}</h3><p>${monthLabel(item.month)}</p></div><div class="table-actions"><button class="table-action" data-action="edit-budget" data-id="${esc(item.id)}">✎</button><button class="table-action" data-action="delete-budget" data-id="${esc(item.id)}">×</button></div></div><div class="metric-value" style="font-size:21px;margin:14px 0 8px">${money(spent,currency)} <span class="small muted" style="font-weight:500">of ${money(item.limit,currency)}</span></div><div class="progress-track"><div class="progress-fill ${ratio>=1?'gold-fill':''}" style="width:${clamp(ratio*100,0,100)}%"></div></div><div class="goal-meta"><span>${Math.round(ratio*100)}% used</span><span>${money(item.limit-spent,currency)} ${item.limit>=spent?'left':'over'}</span></div>${ratio>=.85?`<p class="small" style="color:${ratio>=1?'var(--danger)':'var(--warning)'};margin:10px 0 0">${ratio>=1?'This category is over its planned limit.':'Spending is approaching this category limit.'}</p>`:''}</article>`}).join('')}</div>` : emptyState('Give this month a gentle structure', 'Create a category budget to see how actual spending compares with your plan.', pageButton('＋ Create first budget', 'add-budget'))}
      <div class="section-heading"><div><h3>Budget history</h3><p>Older monthly plans stay available for reference</p></div></div><section class="panel table-panel"><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Month</th><th>Category</th><th>Limit</th><th>Spent</th><th>Remaining</th><th></th></tr></thead><tbody>${budgets.length ? budgets.map(item=>{const spent=spentFor(item);return `<tr><td>${monthLabel(item.month)}</td><td>${esc(item.category)}</td><td>${money(item.limit,currency)}</td><td>${money(spent,currency)}</td><td>${money(item.limit-spent,currency)}</td><td><div class="table-actions"><button class="table-action" data-action="edit-budget" data-id="${esc(item.id)}">✎</button><button class="table-action" data-action="delete-budget" data-id="${esc(item.id)}">×</button></div></td></tr>`}).join('') : '<tr><td colspan="6" class="muted">No budget history yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderDebts() {
    const currency = currentCurrency();
    const debts = state.debts.filter(item => item.currency === currency);
    const totals = debtTotals(currency);
    const payments = state.debtPayments.filter(item => item.currency === currency).sort((a,b)=>b.date.localeCompare(a.date));
    const paid = Math.max(0, totals.original - totals.remaining);
    const recovery = totals.original ? paid / totals.original : 0;
    const snowball = [...debts].sort((a,b)=>a.remaining-b.remaining);
    const avalanche = [...debts].sort((a,b)=>b.rate-a.rate);
    return `${intro('Make room for financial recovery', 'Track outstanding balances and payments. Estimates depend on the interest rate and payment assumptions you enter.', pageButton('＋ Add debt', 'add-debt'))}
      <div class="feature-split"><section class="panel savings-feature"><p class="eyebrow" style="color:#c4d0bd">YOUR RECOVERY GARDEN</p><h2>${plantStage(recovery)}.</h2><p>As your recorded principal falls, your recovery plant grows.</p><div class="savings-total">${money(totals.remaining,currency)}</div><div class="savings-stats"><div><span>ORIGINAL DEBT</span><strong>${money(totals.original,currency)}</strong></div><div><span>PRINCIPAL REDUCED</span><strong>${money(paid,currency)}</strong></div><div><span>RECOVERY</span><strong>${Math.round(recovery*100)}%</strong></div></div><div class="progress-track" style="background:rgba(255,255,255,.15);margin-top:17px"><div class="progress-fill gold-fill" style="width:${recovery*100}%;background:#d4bd88"></div></div></section><section class="panel savings-tree-panel">${plantSVG(recovery,'tree','Debt recovery plant')}<span class="plant-stage-label">${plantStage(recovery).toUpperCase()} · PRINCIPAL REDUCED</span></section></div>
      <div class="grid grid-2" style="margin-top:14px"><section class="panel panel-pad"><h3 style="font:700 13px var(--heading-font);margin:0 0 7px">Debt snowball</h3><p class="small muted">Focus on the smallest remaining balance first. This can create earlier milestones, while total interest may be higher.</p>${snowball.length ? snowball.map((d,i)=>`<div class="goal-row"><div class="goal-row-top"><strong>${i+1}. ${esc(d.name)}</strong><span>${money(d.remaining,currency)}</span></div></div>`).join('') : '<p class="small muted">Add a debt to see the order.</p>'}</section><section class="panel panel-pad"><h3 style="font:700 13px var(--heading-font);margin:0 0 7px">Debt avalanche</h3><p class="small muted">Focus on the highest interest rate first. This can reduce interest cost when other assumptions stay comparable.</p>${avalanche.length ? avalanche.map((d,i)=>`<div class="goal-row"><div class="goal-row-top"><strong>${i+1}. ${esc(d.name)}</strong><span>${number(d.rate).toFixed(2)}% APR</span></div></div>`).join('') : '<p class="small muted">Add a debt to see the order.</p>'}</section></div>
      <div class="section-heading"><div><h3>Debts</h3><p>Remaining principal is adjusted by the principal portion of each payment</p></div></div>
      ${debts.length ? `<div class="grid grid-2">${debts.map(debt=>`<article class="panel debt-card"><div class="debt-card-head"><span class="pill gray">${number(debt.rate).toFixed(2)}% APR</span><div class="table-actions"><button class="table-action" data-action="edit-debt" data-id="${esc(debt.id)}">✎</button><button class="table-action" data-action="delete-debt" data-id="${esc(debt.id)}">×</button></div></div><h3>${esc(debt.name)}</h3><p>${esc(debt.frequency || 'Monthly')} · Minimum ${money(debt.minimumPayment,currency)}</p><div class="metric-value" style="font-size:22px;margin:13px 0 8px">${money(debt.remaining,currency)}</div><div class="progress-track"><div class="progress-fill" style="width:${debt.original?clamp((1-debt.remaining/debt.original)*100,0,100):0}%"></div></div><div class="goal-meta"><span>Original ${money(debt.original,currency)}</span><span>${debt.original?Math.round((1-debt.remaining/debt.original)*100):0}% repaid</span></div><div class="card-bottom-actions"><button class="button button-primary" data-action="pay-debt" data-id="${esc(debt.id)}">＋ Record payment</button><button class="button button-quiet" data-action="estimate-debt" data-id="${esc(debt.id)}">Estimate</button></div></article>`).join('')}</div>` : emptyState('Start your recovery plan', 'Add a debt to track its balance, interest rate and repayment progress.', pageButton('＋ Add first debt', 'add-debt'))}
      <div class="section-heading"><div><h3>Payment history</h3><p>Payment records remain available after balances change</p></div></div><section class="panel table-panel"><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Debt</th><th>Total paid</th><th>Principal</th><th>Interest</th><th></th></tr></thead><tbody>${payments.length?payments.map(p=>{const d=state.debts.find(x=>x.id===p.debtId);return `<tr><td>${dateLabel(p.date)}</td><td>${esc(d?.name || 'Debt removed')}</td><td>${money(p.amount,currency)}</td><td>${money(p.principal,currency)}</td><td>${money(p.interest,currency)}</td><td><button class="table-action" data-action="delete-debt-payment" data-id="${esc(p.id)}" aria-label="Delete payment">×</button></td></tr>`}).join(''):'<tr><td colspan="6" class="muted">No debt payments recorded yet.</td></tr>'}</tbody></table></div></section>`;
  }

  function renderInvestments() {
    const currency = currentCurrency();
    const totals = investmentTotals(currency);
    const investments = state.investments.filter(item => item.currency === currency);
    const changePct = totals.contributed ? totals.change / totals.contributed * 100 : 0;
    return `${intro('Let your investment records take root', 'Track contributions and manually entered valuations over time. No live market prices are fetched or implied.', pageButton('＋ Add investment', 'add-investment'))}
      <div class="grid grid-3" style="margin-bottom:15px"><div class="panel metric-card"><div class="metric-label">Total contributions</div><div class="metric-value">${money(totals.contributed,currency)}</div><div class="metric-foot">Amounts you have entered</div></div><div class="panel metric-card"><div class="metric-label">Current valuation</div><div class="metric-value">${money(totals.valuation,currency)}</div><div class="metric-foot">Manually updated estimate</div></div><div class="panel metric-card"><div class="metric-label">Change vs contributions</div><div class="metric-value">${money(totals.change,currency)}</div><div class="metric-foot ${totals.change>=0?'positive':'negative'}">${changePct.toFixed(2)}% · not a guaranteed return</div></div></div>
      ${investments.length?`<div class="grid grid-3">${investments.map(item=>{const change=item.currentValue-item.contribution;const pct=item.contribution?change/item.contribution*100:0;return `<article class="panel investment-card"><div class="investment-card-head"><span class="account-type-icon">♢</span><div style="display:flex;align-items:center;gap:7px"><button class="table-action" data-action="investment-history" data-id="${esc(item.id)}" aria-label="View valuation history">◷</button><span class="pill gray">${esc(item.category)}</span></div></div><h3>${esc(item.name)}</h3><p>First recorded ${dateLabel(item.purchaseDate)}</p><div class="metric-value" style="font-size:21px;margin:14px 0 3px">${money(item.currentValue,currency)}</div><div class="small ${change>=0?'amount-positive':'amount-negative'}">${change>=0?'+':''}${money(change,currency)} (${pct.toFixed(2)}%)</div><div class="goal-meta"><span>Contributed</span><strong>${money(item.contribution,currency)}</strong></div><div class="card-bottom-actions"><button class="button button-primary" data-action="update-investment" data-id="${esc(item.id)}">Update value</button><button class="button button-quiet" data-action="edit-investment" data-id="${esc(item.id)}">Edit</button><button class="button button-quiet" data-action="delete-investment" data-id="${esc(item.id)}">×</button></div><p class="tiny muted" style="margin-top:11px">Valuation entered by you · ${item.snapshots?.length||0} snapshots</p></article>`}).join('')}</div>`:emptyState('Build your investment overview', 'Add an investment, record what you have contributed, and enter a current valuation when you review it.', pageButton('＋ Add investment', 'add-investment'))}
      <div class="panel panel-pad" style="margin-top:15px"><p class="small muted" style="margin:0;line-height:1.8">The difference shown is a simple comparison between your recorded valuation and recorded contributions. It does not account for every possible fee, tax, income distribution or cash flow unless you record those separately. This tracker does not provide investment recommendations.</p></div>`;
  }

  function renderGoals() {
    const goals = state.goals.filter(item => item.currency === currentCurrency());
    const achieved = goals.filter(item => item.target > 0 && item.current >= item.target).length;
    return `${intro('Give your future a direction', 'Create meaningful targets and record contributions as you make progress. Each goal gets its own little bloom.', pageButton('＋ Create goal', 'add-goal'))}
      <div class="grid grid-3" style="margin-bottom:15px"><div class="panel metric-card"><div class="metric-label">Active goals</div><div class="metric-value">${goals.length}</div><div class="metric-foot">In ${currentCurrency()}</div></div><div class="panel metric-card"><div class="metric-label">Total saved toward goals</div><div class="metric-value">${money(goalSavings(),currentCurrency())}</div><div class="metric-foot">Goal records only</div></div><div class="panel metric-card"><div class="metric-label">Goals reached</div><div class="metric-value">${achieved}</div><div class="metric-foot">Targets fully funded</div></div></div>
      ${goals.length?`<div class="grid grid-3">${goals.map(goal=>goalCard(goal)).join('')}</div>`:emptyState('A goal is a good place to begin', 'A trip, a course, a device, or a safety cushion — make a target and give it a name.', pageButton('＋ Create your first goal', 'add-goal'))}`;
  }

  const calculators = [
    { id:'simple', label:'Simple interest', icon:'∑', fields:[['principal','Starting amount','number',1000],['rate','Annual interest rate (%)','number',5],['years','Time (years)','number',3]], description:'Simple interest is calculated only on the original principal.' },
    { id:'compound', label:'Compound interest', icon:'⌁', fields:[['principal','Starting amount','number',1000],['rate','Annual interest rate (%)','number',5],['years','Time (years)','number',5],['frequency','Compounding','select',['Annually','Semi-annually','Quarterly','Monthly','Daily']]], description:'Compound growth adds earned interest back to the balance. This is a mathematical illustration, not a promised return.' },
    { id:'savings', label:'Savings growth', icon:'♧', fields:[['principal','Starting amount','number',500],['monthly','Monthly contribution','number',100],['rate','Annual interest rate (%)','number',3],['years','Time (years)','number',3]], description:'An estimate based on a starting balance, monthly contributions and a constant annual rate.' },
    { id:'monthly', label:'Monthly savings plan', icon:'✳', fields:[['target','Savings target','number',5000],['current','Already saved','number',500],['months','Months to save','number',12]], description:'Calculates the monthly contribution needed to reach your target, without interest.' },
    { id:'loan', label:'Loan repayment', icon:'▤', fields:[['principal','Loan amount','number',10000],['rate','Annual interest rate (%)','number',6],['months','Repayment period (months)','number',36]], description:'Fixed monthly repayment estimate using a standard amortizing-loan formula.' },
    { id:'emi', label:'EMI calculator', icon:'◫', fields:[['principal','Principal amount','number',25000],['rate','Annual interest rate (%)','number',7],['months','Tenure (months)','number',48]], description:'Equated monthly instalment estimate. Fees and lender-specific rules may differ.' },
    { id:'debt', label:'Debt repayment', icon:'↘', fields:[['principal','Outstanding balance','number',5000],['rate','Annual interest rate (%)','number',8],['payment','Monthly payment','number',250]], description:'Estimates payoff time and interest when a fixed monthly payment exceeds monthly interest.' },
    { id:'investment', label:'Investment return', icon:'♢', fields:[['principal','Starting contribution','number',2000],['rate','Assumed annual return (%)','number',6],['years','Time (years)','number',5]], description:'A hypothetical future value using a constant annual rate. Actual investment results vary and can be negative.' }
  ];
  function renderCalculators() {
    const calc = calculators.find(item => item.id === activeCalculator) || calculators[0];
    const inputFields = calc.fields.map(([name,label,type,value]) => type === 'select' ? selectField(label,name,value,'Monthly') : field(label,name,value,'number','0','min="0" step="any" required')).join('');
    return `${intro('A clearer view of the numbers', 'Explore common financial formulas with editable assumptions. Results are estimates, not quotes or guarantees.', '')}
      <div class="calculator-layout"><aside class="panel calculator-list">${calculators.map(item=>`<button class="calculator-choice ${item.id===activeCalculator?'active':''}" data-action="choose-calculator" data-id="${item.id}"><span>${item.icon}</span>${item.label}</button>`).join('')}</aside>
        <section class="panel calculator-main"><div class="panel-title-row"><div><p class="eyebrow">FINANCIAL TOOL</p><h3 style="font:700 17px var(--heading-font);margin:0">${calc.label}</h3><p>${calc.description}</p></div><span class="pill">ESTIMATE</span></div><form id="calculatorForm"><div class="form-grid" style="margin-top:20px">${inputFields}</div><div class="form-actions"><button class="button button-quiet" type="reset">Reset values</button><button class="button button-primary" type="submit">Calculate result →</button></div></form><div class="calculator-result" id="calculatorResult"><span>YOUR RESULT</span><strong>Enter your assumptions</strong><p>Choose the inputs above, then calculate to see the estimate.</p></div><p class="tiny muted" style="margin:12px 0 0">Calculations use nominal inputs and simplified formulas. Taxes, fees, changing rates, payment dates and provider-specific terms may change real outcomes.</p></section></div>`;
  }

  const lessons = [
    { id:'money-basics', category:'Personal finance', title:'Give every dirham a purpose', summary:'Understand the parts of a simple personal money plan.', body:'<h3>Start with awareness</h3><p>Personal finance is the way you organize the money you receive, spend, save and owe. A useful first step is to write down what comes in and what goes out. You do not need a complicated system — a clear, honest record is enough to begin.</p><h3>Build a simple routine</h3><p>Review your transactions regularly, plan for upcoming needs, and leave room for unexpected costs. A plan should help you make decisions, not make you feel guilty about ordinary spending.</p>' },
    { id:'needs-wants', category:'Personal finance', title:'Needs, wants and thoughtful choices', summary:'Separate essential spending from things you choose to enjoy.', body:'<h3>Needs and wants</h3><p>Needs are expenses that support health, safety and everyday responsibilities. Wants make life enjoyable, but they are usually more flexible. The same purchase can be a need for one person and a want for another depending on their situation.</p><h3>Pause before buying</h3><p>Try asking: Do I need this now? Is there a lower-cost option? What am I giving up by spending this amount? A short pause can make spending more intentional.</p>' },
    { id:'emergency', category:'Saving', title:'Why an emergency fund matters', summary:'Learn how a savings cushion can help with unexpected expenses.', body:'<h3>Prepare for surprises</h3><p>An emergency fund is money set aside for unexpected, necessary costs, such as an urgent repair or a sudden change in income. Its purpose is access and stability, not maximum growth.</p><h3>Build gradually</h3><p>Start with a small target that feels achievable. Keep the money somewhere reasonably accessible and separate from everyday spending. The right amount depends on your circumstances and responsibilities.</p>' },
    { id:'saving-goals', category:'Saving', title:'Make a savings goal useful', summary:'Turn a broad wish into a clear amount and timeline.', body:'<h3>Give the goal a shape</h3><p>Choose what you are saving for, estimate the cost, and decide when you hope to reach it. Divide the remaining amount by the number of months to get a basic monthly target.</p><h3>Review without pressure</h3><p>Life changes. Update your timeline or contribution amount when necessary. A realistic plan that you can maintain is more useful than an ambitious plan that causes stress.</p>' },
    { id:'simple-compound', category:'Interest', title:'Simple and compound interest', summary:'See how interest can be calculated in two different ways.', body:'<h3>Simple interest</h3><p>Simple interest is calculated on the original principal. The basic formula is Interest = Principal × Rate × Time, with the rate and time expressed in matching units.</p><h3>Compound interest</h3><p>Compound interest is calculated on the principal plus previously added interest. The balance can grow faster over time, but the actual rate, frequency and fees matter. The calculators in this app illustrate the formulas using the assumptions you enter.</p>' },
    { id:'budgeting', category:'Budgeting', title:'Build a flexible monthly budget', summary:'Plan spending without making the plan too rigid.', body:'<h3>Start with what is known</h3><p>List expected income and regular expenses. Then identify flexible categories and planned savings. A budget is a guide, not a promise that every month will be identical.</p><h3>Review actual spending</h3><p>Compare your real records with your plan. When a category goes over, understand why and adjust the next plan if needed. Avoid counting transfers between your own accounts as spending.</p>' },
    { id:'debt-strategies', category:'Debt', title:'Snowball and avalanche methods', summary:'Compare two common ways to prioritize debt repayment.', body:'<h3>Debt snowball</h3><p>The snowball method prioritizes the smallest balance first while making required payments on other debts. Clearing a small balance can create a sense of progress.</p><h3>Debt avalanche</h3><p>The avalanche method prioritizes the highest interest rate first. When rates and fees are comparable and payments are maintained, this can reduce total interest. The best approach depends on the full terms of each debt and your ability to stay consistent.</p>' },
    { id:'risk-return', category:'Investing', title:'Understand risk and return', summary:'Learn why potential return and uncertainty are connected.', body:'<h3>Risk is part of investing</h3><p>Investment values can rise and fall. Higher potential returns often come with greater uncertainty and the possibility of loss. Past performance does not guarantee future results.</p><h3>Think in time horizons</h3><p>Money needed soon is generally exposed to a different set of risks than money intended for a long-term goal. Understand what you own, the costs involved and how changes in value could affect your plans.</p>' },
    { id:'diversification', category:'Investing', title:'What diversification means', summary:'Understand why investors spread exposure across different assets.', body:'<h3>Avoid relying on one thing</h3><p>Diversification means spreading investments across different assets, sectors or regions. The aim is to reduce dependence on one holding, although diversification cannot remove all investment risk.</p><h3>Know what you hold</h3><p>Assets that appear different can still move in similar ways. Review the underlying holdings, costs and risks rather than relying only on the number of items in a portfolio.</p>' }
  ];
  const glossary = [
    ['Asset','Something of value that you own, such as cash or an investment.'],['Liability','Money you owe, such as a loan balance.'],['Net worth','Assets minus liabilities, using matching currencies and valuation dates.'],['Principal','The original amount borrowed or invested, before interest or returns.'],['Interest','A cost paid for borrowing or an amount earned on savings or lending.'],['Compound interest','Interest calculated on principal plus previously accumulated interest.'],['Cash flow','Money moving in and out over a period.'],['Diversification','Spreading investments across different exposures to reduce reliance on one holding.'],['Inflation','A broad rise in prices that reduces the purchasing power of money over time.'],['Liquidity','How easily an asset can be turned into spendable money without a major loss in value.'],['APR','Annual percentage rate; a yearly expression of borrowing cost, subject to product rules.'],['EMI','Equated monthly instalment: a fixed monthly loan payment under a given repayment structure.']
  ];
  function renderEducation() {
    const lessonsFiltered = activeEducationFilter === 'All' ? lessons : lessons.filter(item => item.category === activeEducationFilter);
    const categories = ['All', ...new Set(lessons.map(item => item.category))];
    return `${intro('Knowledge is part of the garden', 'Short, beginner-friendly lessons to help you understand everyday financial ideas.', '')}
      <div class="education-hero"><div><p class="eyebrow">THE KNOWLEDGE PLANT</p><h2>Clarity grows with learning.</h2><p>Explore a topic, take away one useful idea, and return when you are ready for the next.</p></div><div class="education-mark">♧</div></div>
      <div class="section-heading"><div><h3>Learning library</h3><p>${state.completedLessons.length} of ${lessons.length} topics marked as read</p></div></div><div class="toolbar panel" style="margin-bottom:13px;border:1px solid var(--line);border-radius:10px">${categories.map(cat=>`<button class="filter-chip ${activeEducationFilter===cat?'active':''}" data-action="education-filter" data-id="${esc(cat)}">${esc(cat)}</button>`).join('')}</div>
      <div class="grid grid-3">${lessonsFiltered.map(lesson=>`<article class="panel lesson-card"><span class="lesson-category">${esc(lesson.category)}</span><h3>${esc(lesson.title)} ${state.completedLessons.includes(lesson.id)?'<span class="pill">Read</span>':''}</h3><p>${esc(lesson.summary)}</p><button class="button button-quiet" data-action="open-lesson" data-id="${esc(lesson.id)}">Read lesson →</button></article>`).join('')}</div>
      <div class="section-heading"><div><h3>Financial glossary</h3><p>Common terms in plain language</p></div></div><section class="panel panel-pad"><input class="field" type="search" id="glossarySearch" placeholder="Search a financial term…" aria-label="Search glossary" style="max-width:330px;margin-bottom:10px"/><div id="glossaryList">${glossary.map(([term,definition])=>`<div class="glossary-item" data-search="${esc((term+' '+definition).toLowerCase())}"><strong>${esc(term)}</strong><p>${esc(definition)}</p></div>`).join('')}</div></section>
      <div class="section-heading"><div><h3>Growth assistant</h3><p>A small offline guide for general financial concepts</p></div></div><section class="panel panel-pad"><p class="small muted" style="margin-top:0">This helper uses a short built-in educational knowledge set. It is not connected to an AI service and does not review your personal finances.</p><form id="assistantForm" class="form-grid"><label class="full"><span class="field-label">Ask about a financial term or topic</span><input class="field" name="question" placeholder="For example: What is compound interest?" required /></label><div class="full form-actions" style="padding-top:0"><button class="button button-primary" type="submit">Ask Growth Assistant →</button></div></form><div id="assistantAnswer" class="small muted" aria-live="polite"></div></section>`;
  }

  function renderReports() {
    const currency = currentCurrency();
    const months = Array.from({length:12},(_,index)=>`${activeReportYear}-${String(index+1).padStart(2,'0')}`);
    const annualIncome = sum(state.transactions.filter(tx=>tx.currency===currency && tx.type==='income' && tx.date.startsWith(activeReportYear)), tx=>tx.amount);
    const annualExpenses = sum(state.transactions.filter(tx=>tx.currency===currency && tx.type==='expense' && tx.date.startsWith(activeReportYear)), tx=>tx.amount) - sum(state.transactions.filter(tx=>tx.currency===currency && tx.type==='refund' && tx.date.startsWith(activeReportYear)), tx=>tx.amount);
    const reportYears = [...new Set([String(new Date().getFullYear()), ...state.transactions.map(tx=>tx.date.slice(0,4)), ...state.snapshots.map(item=>item.date.slice(0,4))])].sort((a,b)=>b.localeCompare(a));
    const incomeExpenseRows = months.map(month=>({month,income:monthIncome(month,currency),expenses:monthExpenses(month,currency)}));
    const snapshots = state.snapshots.filter(item=>item.currency===currency).sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
    return `${intro('Your progress, made visible', 'Review the records you have entered and export a copy whenever you need one.', `${pageButton('↓ Export transactions CSV', 'export-csv', false)}${pageButton('↓ Full data backup', 'export-json')}<select class="select-small" id="reportYear" aria-label="Report year">${reportYears.map(year=>`<option value="${year}" ${year===activeReportYear?'selected':''}>${year}</option>`).join('')}</select>`)}
      <div class="grid grid-3" style="margin-bottom:14px"><div class="panel metric-card"><div class="metric-label">Income this year</div><div class="metric-value">${money(annualIncome,currency)}</div><div class="metric-foot">${activeReportYear}</div></div><div class="panel metric-card"><div class="metric-label">Expenses this year</div><div class="metric-value">${money(annualExpenses,currency)}</div><div class="metric-foot">Refunds reduce this total</div></div><div class="panel metric-card"><div class="metric-label">Annual cash flow</div><div class="metric-value">${money(annualIncome-annualExpenses,currency)}</div><div class="metric-foot">Based on recorded transactions</div></div></div>
      <div class="grid grid-2 report-chart-grid"><section class="panel chart-panel"><div class="panel-title-row"><div><h3>Income vs expenses</h3><p>Monthly totals for ${activeReportYear} · ${currency}</p></div><span class="pill">BAR</span></div><div class="chart-wrap"><canvas id="reportCashChart" aria-label="Grouped bar chart comparing income and expenses"></canvas></div><div class="legend-row"><span class="legend-item"><i class="legend-dot"></i> Income</span><span class="legend-item"><i class="legend-dot gold-dot"></i> Expenses</span></div></section><section class="panel chart-panel"><div class="panel-title-row"><div><h3>Spending breakdown</h3><p>Expense categories for ${activeReportYear}</p></div><span class="pill">PIE</span></div><div class="chart-visual-split"><div class="chart-wrap chart-wrap-square"><canvas id="reportExpensePie" aria-label="Pie chart showing annual expense categories"></canvas></div><div class="chart-legend-list" id="reportExpenseLegend"></div></div></section><section class="panel chart-panel"><div class="panel-title-row"><div><h3>Net worth history</h3><p>Snapshots saved when your records change</p></div><span class="pill">LINE</span></div><div class="chart-wrap"><canvas id="netWorthChart" aria-label="Net worth history line chart"></canvas></div><p class="tiny muted">Only saved snapshots are shown; earlier values are not reconstructed.</p></section></div>
      <div class="section-heading"><div><h3>Monthly report</h3><p>Records in ${currency}; transfers are excluded from income and expenses</p></div></div><section class="panel table-panel"><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Cash flow</th></tr></thead><tbody>${incomeExpenseRows.map(row=>`<tr><td>${monthLabel(row.month)}</td><td class="amount-positive">${money(row.income,currency)}</td><td class="amount-negative">${money(row.expenses,currency)}</td><td>${money(row.income-row.expenses,currency)}</td></tr>`).join('')}</tbody></table></div></section>
      <div class="section-heading"><div><h3>Data export</h3><p>Keep your own backup — local browser storage is not cloud storage</p></div></div><section class="panel panel-pad"><p class="small muted" style="margin:0 0 12px;line-height:1.8">A JSON backup contains the records and preferences stored by this app. CSV exports are intended for spreadsheet review and may not include every relationship or setting. Store exported files somewhere private.</p><button class="button button-primary" data-action="export-json">Download full backup ↓</button></section>`;
  }

  function renderSettings() {
    const s = state.settings;
    const tabs = [
      ['appearance', 'Appearance', '◐', 'Theme, colour and type'],
      ['workspace', 'Workspace', '▦', 'Currency and dashboard'],
      ['data', 'Data & privacy', '▤', 'Backups and local storage']
    ];
    const storageText = (() => {
      try {
        const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
        return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
      } catch (_) { return 'Unavailable'; }
    })();
    const toggle = (key, label, description, checked) => `
      <label class="setting-row setting-toggle-row">
        <span class="setting-copy"><strong>${label}</strong><small>${description}</small></span>
        <input type="checkbox" class="toggle" data-setting="${key}" ${checked ? 'checked' : ''} aria-label="${label}" />
      </label>`;
    const selectSetting = (key, label, description, choices, selected) => `
      <label class="setting-row">
        <span class="setting-copy"><strong>${label}</strong><small>${description}</small></span>
        <select class="select-field setting-select" data-setting="${key}" aria-label="${label}">
          ${choices.map(([value, text]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${text}</option>`).join('')}
        </select>
      </label>`;

    let content = '';
    if (activeSettingsTab === 'appearance') {
      const palettes = [
        ['#245943', 'Emerald'], ['#496B52', 'Botanical'], ['#56758B', 'Slate'],
        ['#8C684A', 'Clay'], ['#78628E', 'Plum'], ['#A36A58', 'Terracotta']
      ];
      content = `
        <div class="settings-panel-heading"><div><span class="settings-overline">MAKE IT YOURS</span><h3>Appearance</h3><p>Shape a calmer workspace that feels clear, comfortable and familiar.</p></div><button class="button button-quiet" data-action="reset-appearance">Restore defaults</button></div>
        <div class="settings-preview">
          <div class="settings-preview-copy"><span class="settings-preview-label">LIVE PREVIEW</span><strong>Good things grow with clarity.</strong><span>Your selected settings are applied across the workspace.</span></div>
          <div class="settings-preview-card"><span class="preview-dot"></span><span class="preview-bar"></span><span class="preview-bar short"></span><span class="preview-button">Preview</span></div>
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Colour & style</h4><p>Choose a palette and the accent used for important actions.</p></div>
          ${selectSetting('theme', 'Colour theme', 'Light, dark and nature-inspired options. System follows your device preference.', [['light','Light'],['dark','Dark'],['green','Green'],['emerald','Emerald'],['forest','Forest'],['system','System default']], s.theme)}
          <div class="setting-row accent-row"><span class="setting-copy"><strong>Accent colour</strong><small>Pick a custom colour or use one of the curated accents below.</small><span class="accent-presets">${palettes.map(([color,name])=>`<button type="button" class="accent-swatch ${String(s.accent).toLowerCase()===color.toLowerCase()?'selected':''}" style="--swatch:${color}" data-action="set-accent" data-id="${color}" title="${name}" aria-label="Use ${name} accent"></button>`).join('')}</span></span><input type="color" class="accent-picker" data-setting="accent" value="${esc(s.accent || '#245943')}" aria-label="Choose custom accent colour" /></div>
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Reading & layout</h4><p>Adjust text and spacing for your preferred viewing experience.</p></div>
          ${selectSetting('font', 'Interface font', 'Choose the typeface used throughout the app.', [['manrope','Manrope'],['inter','Inter'],['poppins','Poppins'],['roboto','Roboto'],['system','System default']], s.font)}
          ${selectSetting('textSize', 'Text size', 'Make interface text smaller or larger.', [['small','Small'],['normal','Standard'],['large','Large']], s.textSize)}
          ${selectSetting('layout', 'Layout density', 'Comfortable gives more breathing room; compact fits more content.', [['comfortable','Comfortable'],['compact','Compact']], s.layout)}
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Visual details & motion</h4><p>Keep decorative elements only when they help your experience.</p></div>
          ${toggle('botanical', 'Botanical illustrations', 'Show or hide plant illustrations throughout the app.', s.botanical !== false)}
          ${toggle('animations', 'Subtle animations', 'Enable gentle transitions and leaf movement.', s.animations !== false)}
          ${toggle('reducedMotion', 'Reduce motion', 'Minimize movement for a calmer, more accessible interface.', !!s.reducedMotion)}
        </div>`;
    } else if (activeSettingsTab === 'workspace') {
      const widgets = s.dashboardWidgets || {};
      const categoryList = state.customExpenseCategories || [];
      content = `
        <div class="settings-panel-heading"><div><span class="settings-overline">YOUR DAILY VIEW</span><h3>Workspace</h3><p>Set your preferred currency and choose what appears in your financial overview.</p></div></div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Financial defaults</h4><p>These choices affect new records and how figures are displayed.</p></div>
          ${selectSetting('currency', 'Display currency', 'New records use this currency by default. Existing records keep their saved currency.', currencyOptions.map(value=>[value,value]), s.currency)}
          <div class="settings-note"><span class="settings-note-icon">ⓘ</span><span><strong>Currency totals stay separate</strong><small>Changing the display currency does not convert old records. FINANCE GROWTH does not use live exchange rates, so different currencies are never silently added together.</small></span></div>
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Dashboard widgets</h4><p>Show the panels that are most useful to you. Changes are saved automatically.</p></div>
          ${toggle('widget-cashFlow', 'Cash flow chart', 'Income and expenses for the current month.', widgets.cashFlow !== false)}
          ${toggle('widget-garden', 'Financial garden', 'Your progress-linked botanical overview.', widgets.garden !== false)}
          ${toggle('widget-recent', 'Recent activity', 'Your latest recorded transactions.', widgets.recent !== false)}
          ${toggle('widget-goals', 'Goals and upcoming payments', 'Active goals and payment reminders.', widgets.goals !== false)}
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Expense categories</h4><p>Create labels that match the way you organize your spending.</p></div>
          <div class="setting-row"><span class="setting-copy"><strong>Custom categories</strong><small>${categoryList.length ? `${categoryList.length} custom ${categoryList.length === 1 ? 'category' : 'categories'} added.` : 'No custom categories yet.'}</small></span><button class="button button-quiet" data-action="add-expense-category">＋ Add category</button></div>
          ${categoryList.length ? `<div class="category-chip-list">${categoryList.map(name=>`<span class="category-chip">${esc(name)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Navigation</h4><p>Return to the opening screen without losing any saved records.</p></div>
          <div class="setting-row"><span class="setting-copy"><strong>Welcome screen</strong><small>Revisit the FINANCE GROWTH introduction.</small></span><button class="button button-quiet" data-action="return-welcome-settings">Open welcome ↗</button></div>
        </div>`;
    } else {
      content = `
        <div class="settings-panel-heading"><div><span class="settings-overline">KEEP YOUR RECORDS SAFE</span><h3>Data & privacy</h3><p>Your information is saved locally in this browser. You stay in control of your backups.</p></div></div>
        <div class="privacy-status"><div class="privacy-status-icon">⌂</div><div><strong>Stored on this device</strong><span>No bank connection · No automatic cloud sync</span></div><span class="privacy-indicator">LOCAL</span></div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Local account</h4><p>Your sign-in profile for this browser.</p></div><div class="setting-row"><span class="setting-copy"><strong>${esc(activeUser?.displayName || 'Local profile')}</strong><small>${esc(activeUser?.login || '')} · Password verification stays on this device.</small></span><button class="button button-quiet" data-action="sign-out">Sign out</button></div><div class="settings-note"><span class="settings-note-icon">ⓘ</span><span><strong>Important account limitation</strong><small>This profile is stored locally, not on a server. It does not provide cloud sync, email verification or password recovery. Anyone with access to this browser's local data may be able to access its stored records. Export a backup before changing or clearing devices.</small></span></div></div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Back up & restore</h4><p>Make a copy before changing devices or clearing browser data.</p></div>
          <div class="setting-row"><span class="setting-copy"><strong>Export full backup</strong><small>Download a JSON file containing your records and preferences.</small></span><button class="button button-primary" data-action="export-json">Export backup ↓</button></div>
          <div class="setting-row"><span class="setting-copy"><strong>Import backup</strong><small>Restore a FINANCE GROWTH JSON backup. Current records will be replaced.</small></span><label class="button button-quiet file-picker-button" for="backupFile">Choose JSON file</label><input id="backupFile" type="file" accept="application/json,.json" hidden /></div>
          <div class="setting-row"><span class="setting-copy"><strong>Export transactions</strong><small>Download transaction history as a CSV spreadsheet.</small></span><button class="button button-quiet" data-action="export-csv">Export CSV ↓</button></div>
        </div>
        <div class="settings-group"><div class="settings-group-heading"><h4>Storage & privacy</h4><p>A simple view of the data saved by this browser.</p></div>
          <div class="storage-meter-row"><span><strong>Approximate local storage used</strong><small>Current FINANCE GROWTH data size (not your browser's total storage).</small></span><strong class="storage-size">${storageText}</strong></div>
          <div class="settings-note"><span class="settings-note-icon">ⓘ</span><span><strong>Important privacy information</strong><small>LocalStorage is not encrypted banking storage. Browser settings or clearing site data can remove it, and it does not provide automatic cloud backups. Do not store passwords, card security codes or highly sensitive credentials. Export backups and keep them somewhere private.</small></span></div>
        </div>
        <div class="settings-group danger-zone"><div class="settings-group-heading"><h4>Reset options</h4><p>These actions cannot be undone after confirmation. Export a backup first if needed.</p></div>
          <div class="setting-row"><span class="setting-copy"><strong>Reset preferences only</strong><small>Restore default theme, typography, currency and dashboard settings. Financial records remain untouched.</small></span><button class="button button-quiet" data-action="reset-preferences">Reset preferences</button></div>
          <div class="setting-row"><span class="setting-copy"><strong>Clear all application data</strong><small>Delete accounts, transactions, goals, budgets, debts, investments and preferences from this browser.</small></span><button class="button button-danger" data-action="reset-data">Reset all data</button></div>
        </div>`;
    }

    return `${intro('A space that works your way', 'Refine the look, daily workspace and privacy settings of FINANCE GROWTH.', '<span class="settings-save-state"><i></i> Changes save automatically</span>')}
      <div class="settings-layout">
        <aside class="panel settings-nav" aria-label="Settings sections">
          <span class="settings-nav-label">SETTINGS</span>
          ${tabs.map(([id,label,icon,detail])=>`<button type="button" class="settings-tab ${id===activeSettingsTab?'active':''}" data-action="settings-tab" data-id="${id}" aria-pressed="${id===activeSettingsTab}"><span class="settings-tab-icon">${icon}</span><span><strong>${label}</strong><small>${detail}</small></span><span class="settings-tab-arrow">›</span></button>`).join('')}
          <div class="settings-nav-foot"><span class="settings-nav-mark">✳</span><span><strong>FINANCE GROWTH</strong><small>Grow with clarity.</small></span></div>
        </aside>
        <section class="panel settings-content">${content}</section>
      </div>`;
  }

  // --------------------------- Forms and record actions ---------------------------
  const modalBackdrop = $('#modalBackdrop');
  function openModal(title, eyebrow, html, onSubmit = null) {
    $('#modalTitle').textContent = title;
    $('#modalEyebrow').textContent = eyebrow || 'ADD TO YOUR GARDEN';
    $('#modalBody').innerHTML = html;
    modalBackdrop.classList.remove('hidden');
    const form = $('#modalBody form');
    if (form && onSubmit) form.addEventListener('submit', event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (onSubmit(data, form) !== false) closeModal();
    });
    setTimeout(() => $('#modalBody input:not([type="hidden"]), #modalBody select')?.focus(), 40);
  }
  function closeModal() { modalBackdrop.classList.add('hidden'); $('#modalBody').innerHTML = ''; }
  function toast(message, kind = 'success') {
    const element = document.createElement('div');
    element.className = `toast ${kind === 'error' ? 'error' : kind === 'info' ? 'info' : ''}`;
    element.textContent = message;
    $('#toastRegion').appendChild(element);
    setTimeout(() => element.remove(), 3300);
  }
  function confirmAction(message) { return window.confirm(message); }

  function accountForm(account = null) {
    const isEdit = !!account;
    openModal(isEdit ? 'Edit account' : 'Create an account', 'MY ACCOUNTS', `<form><div class="form-grid">
      ${field('Account name','name',account?.name || '', 'text','e.g. Everyday cash','required maxlength="60"')}
      ${selectField('Account type','type',accountTypes,account?.type || 'Cash')}
      ${field('Opening balance','openingBalance',account?.openingBalance ?? 0,'number','0','min="0" step="0.01" required')}
      ${selectField('Currency','currency',currencyOptions,account?.currency || currentCurrency())}
      ${textareaField('Description (optional)','description',account?.description || '', 'A short note about this account')}
    </div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${isEdit?'Save changes':'Create account'}</button></div></form>`, data => {
      if (!data.name.trim()) return toast('Add an account name.', 'error'), false;
      const record = { id: account?.id || uid(), name: data.name.trim(), type: data.type, openingBalance: Math.max(0, number(data.openingBalance)), currency: data.currency, description: data.description.trim() };
      if (isEdit) state.accounts = state.accounts.map(item => item.id === account.id ? record : item); else state.accounts.push(record);
      commit(isEdit ? 'Account updated.' : 'Account created.');
    });
  }

  function transactionForm(type = 'expense', transaction = null, forcedTransfer = false) {
    const existing = transaction;
    const actualType = existing?.type || (forcedTransfer ? 'transfer' : type);
    const currency = existing?.currency || currentCurrency();
    if (!state.accounts.some(item => item.currency === currency)) {
      closeModal();
      toast('Create an account in this currency before recording a transaction.', 'info');
      accountForm();
      return;
    }
    const selectedAccount = existing?.accountId || state.accounts.find(item=>item.currency===currency)?.id;
    const typeOptions = ['income','expense','refund','transfer'];
    openModal(existing ? 'Edit transaction' : actualType === 'transfer' ? 'Transfer between accounts' : `Record ${actualType}`, 'TRANSACTIONS', `<form><div class="form-grid">
      ${selectField('Record type','type',typeOptions,actualType,'data-type-select')}
      ${field('Amount','amount',existing?.amount ?? '', 'number','0.00','min="0.01" step="0.01" required')}
      ${selectField('Currency','currency',currencyOptions,currency,'data-currency-select')}
      <label><span class="field-label">From / linked account</span><select class="select-field" name="accountId" required>${accountOptions(selectedAccount,currency)}</select></label>
      <label class="${actualType==='transfer'?'':'hidden'}" data-destination-wrap><span class="field-label">Destination account</span><select class="select-field" name="toAccountId">${accountOptions(existing?.toAccountId || '',currency)}</select></label>
      <label class="${actualType==='transfer'?'hidden':''}" data-category-wrap><span class="field-label">Category</span><select class="select-field" name="category">${options(actualType==='income'?incomeCategories:allExpenseCategories(),existing?.category || (actualType==='income'?'Salary':'Other'))}</select></label>
      ${field('Date','date',existing?.date || today(),'date','')}
      <label><span class="field-label">Payment method (optional)</span><select class="select-field" name="paymentMethod">${options(['Cash','Debit card','Credit card','Bank transfer','Other'],existing?.paymentMethod || 'Cash')}</select></label>
      ${textareaField('Note (optional)','note',existing?.note || '', 'What was this for?')}
    </div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${existing?'Save changes':'Save transaction'}</button></div></form>`, data => {
      const amount = number(data.amount);
      if (!(amount > 0)) return toast('Enter an amount greater than zero.', 'error'), false;
      if (!data.accountId) return toast('Choose an account.', 'error'), false;
      if (data.type === 'transfer') {
        if (!data.toAccountId || data.toAccountId === data.accountId) return toast('Choose a different destination account.', 'error'), false;
        const a = state.accounts.find(item=>item.id===data.accountId); const b=state.accounts.find(item=>item.id===data.toAccountId);
        if (!a || !b || a.currency !== b.currency || a.currency !== data.currency) return toast('Transfers must use two accounts with the same currency.', 'error'), false;
      }
      const record = { id: existing?.id || uid(), type: data.type, amount: round2(amount), currency: data.currency, accountId: data.accountId, toAccountId: data.type==='transfer'?data.toAccountId:'', category: data.type==='transfer'?'Transfer':(data.category || 'Other'), date: data.date || today(), note: data.note.trim(), paymentMethod: data.paymentMethod || '' };
      if (existing) state.transactions = state.transactions.map(item=>item.id===existing.id?record:item); else state.transactions.push(record);
      commit(existing ? 'Transaction updated.' : 'Transaction saved.');
    });
    const typeSelect = $('#modalBody [data-type-select]');
    const currencySelect = $('#modalBody [data-currency-select]');
    function syncTransactionForm() {
      const currentType = typeSelect.value;
      $('#modalBody [data-destination-wrap]').classList.toggle('hidden',currentType!=='transfer');
      $('#modalBody [data-category-wrap]').classList.toggle('hidden',currentType==='transfer');
      const categorySelect = $('#modalBody select[name="category"]');
      if (categorySelect && currentType !== 'transfer') { const oldCategory = categorySelect.value; const categories = currentType === 'income' ? incomeCategories : allExpenseCategories(); categorySelect.innerHTML = options(categories, categories.includes(oldCategory) ? oldCategory : categories[0]); }
      const currencyValue = currencySelect.value;
      const accountSelects = $$('#modalBody select[name="accountId"], #modalBody select[name="toAccountId"]');
      accountSelects.forEach(select=>{const prev=select.value;select.innerHTML=accountOptions(prev,currencyValue);});
    }
    typeSelect?.addEventListener('change',syncTransactionForm);
    currencySelect?.addEventListener('change',syncTransactionForm);
  }

  function goalForm(goal = null) {
    const isEdit = !!goal;
    openModal(isEdit?'Edit savings goal':'Create a savings goal','FINANCIAL GOALS',`<form><div class="form-grid">
      ${field('Goal name','name',goal?.name || '', 'text','e.g. A learning fund','required maxlength="70"')}
      ${field('Target amount','target',goal?.target ?? '', 'number','0.00','min="0.01" step="0.01" required')}
      ${field('Already saved','current',goal?.current ?? 0,'number','0.00','min="0" step="0.01" required')}
      ${selectField('Currency','currency',currencyOptions,goal?.currency || currentCurrency())}
      ${field('Target date (optional)','targetDate',goal?.targetDate || '', 'date')}
      ${textareaField('Description','description',goal?.description || '', 'What are you saving for?')}
    </div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${isEdit?'Save changes':'Create goal'}</button></div></form>`,data=>{
      if (!data.name.trim() || number(data.target)<=0) return toast('Add a goal name and a target greater than zero.','error'),false;
      const record={id:goal?.id||uid(),name:data.name.trim(),target:round2(data.target),current:round2(data.current),currency:data.currency,targetDate:data.targetDate,description:data.description.trim(),history:goal?.history||[]};
      if (isEdit) state.goals=state.goals.map(item=>item.id===goal.id?record:item); else { if(record.current>0) record.history.push({id:uid(),amount:record.current,date:today(),note:'Initial saved amount'});state.goals.push(record); }
      commit(isEdit?'Goal updated.':'Savings goal created.');
    });
  }
  function contributeGoalForm(goal) {
    openModal(`Contribute to ${goal.name}`,'MONEY TREE',`<form><div class="form-grid">${field('Contribution amount','amount','','number','0.00','min="0.01" step="0.01" required')}${field('Date','date',today(),'date')}${textareaField('Note (optional)','note','','Contribution note')}</div><p class="tiny muted">This records progress toward the goal. It does not change an account balance.</p><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">Add contribution</button></div></form>`,data=>{
      const amount=number(data.amount);if(amount<=0)return toast('Enter a contribution greater than zero.','error'),false;
      const found=state.goals.find(item=>item.id===goal.id);if(!found)return false;
      found.current=round2(found.current+amount);found.history=found.history||[];found.history.push({id:uid(),amount:round2(amount),date:data.date||today(),note:data.note.trim()});
      commit('Your goal has grown.');
    });
  }
  function budgetForm(budget = null) {
    const isEdit=!!budget;
    openModal(isEdit?'Edit budget':'Create category budget','BUDGET PLANNER',`<form><div class="form-grid">${selectField('Category','category',allExpenseCategories(),budget?.category||'Food')}${field('Monthly limit','limit',budget?.limit??'','number','0.00','min="0.01" step="0.01" required')}${field('Month','month',budget?.month||monthKey(),'month','')}${selectField('Currency','currency',currencyOptions,budget?.currency||currentCurrency())}</div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${isEdit?'Save budget':'Create budget'}</button></div></form>`,data=>{
      if(number(data.limit)<=0)return toast('Enter a budget limit greater than zero.','error'),false;
      const duplicate=state.budgets.find(item=>item.id!==budget?.id&&item.category===data.category&&item.month===data.month&&item.currency===data.currency);
      if(duplicate)return toast('A budget already exists for that category, month and currency. Edit it instead.','error'),false;
      const record={id:budget?.id||uid(),category:data.category,limit:round2(data.limit),month:data.month,currency:data.currency};
      if(isEdit)state.budgets=state.budgets.map(item=>item.id===budget.id?record:item);else state.budgets.push(record);
      commit(isEdit?'Budget updated.':'Budget created.');
    });
  }
  function debtForm(debt = null) {
    const isEdit=!!debt;
    openModal(isEdit?'Edit debt':'Add a debt','DEBT MANAGEMENT',`<form><div class="form-grid">${field('Debt name','name',debt?.name||'','text','e.g. Personal loan','required maxlength="70"')}${field('Original principal','original',debt?.original??'','number','0.00','min="0.01" step="0.01" required')}${field('Remaining principal','remaining',debt?.remaining??'','number','0.00','min="0" step="0.01" required')}${field('Annual interest rate (%)','rate',debt?.rate??0,'number','0','min="0" step="0.01" required')}${field('Minimum payment','minimumPayment',debt?.minimumPayment??0,'number','0','min="0" step="0.01"')}${selectField('Payment frequency','frequency',['Monthly','Weekly','Fortnightly','Quarterly','Other'],debt?.frequency||'Monthly')}${field('Start date','startDate',debt?.startDate||today(),'date')}${field('Next due date','dueDate',debt?.dueDate||'','date')}${selectField('Currency','currency',currencyOptions,debt?.currency||currentCurrency())}</div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${isEdit?'Save changes':'Add debt'}</button></div></form>`,data=>{
      if(!data.name.trim()||number(data.original)<=0||number(data.remaining)<0||number(data.remaining)>number(data.original))return toast('Check the debt name and principal amounts. Remaining principal must be between zero and original principal.','error'),false;
      const record={id:debt?.id||uid(),name:data.name.trim(),original:round2(data.original),remaining:round2(data.remaining),rate:Math.max(0,number(data.rate)),minimumPayment:Math.max(0,number(data.minimumPayment)),frequency:data.frequency,startDate:data.startDate,dueDate:data.dueDate,currency:data.currency};
      if(isEdit)state.debts=state.debts.map(item=>item.id===debt.id?record:item);else state.debts.push(record);
      commit(isEdit?'Debt updated.':'Debt added.');
    });
  }
  function payDebtForm(debt) {
    const fundingAccounts = state.accounts.filter(account => account.currency === debt.currency);
    if (!fundingAccounts.length) { toast(`Create an account in ${debt.currency} before recording a payment.`, 'info'); accountForm(); return; }
    openModal(`Record payment · ${debt.name}`,'RECOVERY GARDEN',`<form><div class="form-grid">${field('Total payment amount','amount','','number','0.00','min="0.01" step="0.01" required')}${field('Interest portion','interest','0','number','0.00','min="0" step="0.01" required')}<label><span class="field-label">Paid from account</span><select class="select-field" name="accountId" required>${accountOptions(fundingAccounts[0].id,debt.currency)}</select></label>${field('Payment date','date',today(),'date')}${textareaField('Note (optional)','note','','Payment reference')}</div><p class="tiny muted">The principal portion is total payment minus interest. The full payment is also recorded as a cash outflow against the selected account.</p><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">Save payment</button></div></form>`,data=>{
      const amount=number(data.amount),interest=number(data.interest),principal=round2(amount-interest);
      const found=state.debts.find(item=>item.id===debt.id);const account=state.accounts.find(item=>item.id===data.accountId);
      if(!found||!account||account.currency!==found.currency||amount<=0||interest<0||principal<0||principal>found.remaining||interest>amount)return toast('Check the payment, interest and funding account. Principal cannot exceed the remaining balance.','error'),false;
      if(accountBalance(account)+0.00001<amount)return toast('The selected account does not have enough recorded balance for this payment.','error'),false;
      found.remaining=round2(found.remaining-principal);
      const transactionId=uid();const paymentId=uid();
      state.transactions.push({id:transactionId,type:'expense',amount:round2(amount),currency:found.currency,accountId:account.id,toAccountId:'',category:'Debt repayment',date:data.date||today(),note:`Payment for ${found.name}${data.note.trim()?` · ${data.note.trim()}`:''}`,paymentMethod:'Bank transfer',relatedDebtPaymentId:paymentId});
      state.debtPayments.push({id:paymentId,debtId:found.id,transactionId,amount:round2(amount),interest:round2(interest),principal,date:data.date||today(),note:data.note.trim(),currency:found.currency});
      commit('Debt payment recorded and linked to the account.');
    });
  }
  function investmentForm(investment = null) {
    const isEdit=!!investment;
    const currency=investment?.currency||currentCurrency();
    const accounts=state.accounts.filter(account=>account.currency===currency);
    const defaultAccount=investment?.fundingAccountId||accounts[0]?.id||'';
    openModal(isEdit?'Edit investment':'Add investment','INVESTMENT TREE',`<form><div class="form-grid">${field('Investment name','name',investment?.name||'','text','e.g. Broad market fund','required maxlength="70"')}${selectField('Category','category',investmentCategories,investment?.category||'Stocks')}${field('Total contributions','contribution',investment?.contribution??'','number','0.00','min="0" step="0.01" required')}${field('Current valuation','currentValue',investment?.currentValue??'','number','0.00','min="0" step="0.01" required')}${field('First purchase date','purchaseDate',investment?.purchaseDate||today(),'date')}${selectField('Currency','currency',currencyOptions,currency,isEdit?'disabled':'')}${isEdit?`<input type="hidden" name="currency" value="${esc(currency)}">`:''}<label class="full"><span class="field-label">Funding account for contributions</span><select class="select-field" name="fundingAccountId"><option value="">No linked account</option>${accounts.map(account=>`<option value="${esc(account.id)}" ${account.id===defaultAccount?'selected':''}>${esc(account.name)} · ${esc(account.currency)}</option>`).join('')}</select><span class="field-hint">Choose an account only when these contributions should reduce its balance. Leave this blank for an existing holding already reflected in your starting balances.</span></label></div><p class="tiny muted">Enter valuations manually. The app does not fetch market prices or calculate live performance.</p><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">${isEdit?'Save changes':'Add investment'}</button></div></form>`,data=>{
      const contribution=round2(data.contribution),valuation=round2(data.currentValue);
      if(!data.name.trim()||contribution<0||valuation<0)return toast('Check the investment name and amounts.','error'),false;
      const fundingAccount=state.accounts.find(account=>account.id===data.fundingAccountId);
      if(fundingAccount&&fundingAccount.currency!==data.currency)return toast('Choose a funding account in the investment currency.','error'),false;
      if(fundingAccount){const available=accountBalance(fundingAccount)+(isEdit&&investment.fundingAccountId===fundingAccount.id?investment.contribution:0);if(contribution>available+0.00001)return toast('The selected account does not have enough recorded balance for these contributions.','error'),false;}
      const record={id:investment?.id||uid(),name:data.name.trim(),category:data.category,contribution,currentValue:valuation,purchaseDate:data.purchaseDate,currency:data.currency,fundingAccountId:data.fundingAccountId||'',snapshots:investment?.snapshots||[]};
      if(!isEdit||record.currentValue!==(investment.currentValue))record.snapshots.push({date:today(),value:record.currentValue});
      // Rebuild this investment's linked funding movement so an edited contribution never double-counts cash.
      state.transactions=state.transactions.filter(tx=>tx.relatedInvestmentId!==record.id);
      if(contribution>0&&fundingAccount){state.transactions.push({id:uid(),type:'investment',amount:contribution,currency:record.currency,accountId:fundingAccount.id,toAccountId:'',category:'Investment contribution',date:record.purchaseDate||today(),note:`Funding for ${record.name}`,paymentMethod:'Internal movement',relatedInvestmentId:record.id});}
      if(isEdit)state.investments=state.investments.map(item=>item.id===investment.id?record:item);else state.investments.push(record);
      commit(isEdit?'Investment updated.':'Investment added.');
    });
  }
  function updateInvestmentForm(investment) {
    openModal(`Update valuation · ${investment.name}`,'MANUAL VALUATION',`<form><div class="form-grid">${field('New current valuation','currentValue',investment.currentValue,'number','0.00','min="0" step="0.01" required')}${field('Valuation date','date',today(),'date')}</div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">Save valuation</button></div></form>`,data=>{
      const value=number(data.currentValue);if(value<0)return toast('Valuation cannot be negative.','error'),false;
      const found=state.investments.find(item=>item.id===investment.id);if(!found)return false;
      found.currentValue=round2(value);found.snapshots=found.snapshots||[];found.snapshots.push({date:data.date||today(),value:found.currentValue});
      commit('Manual valuation updated.');
    });
  }

  // --------------------------- Calculations ---------------------------
  function calculate(id, values) {
    const p=Math.max(0,number(values.principal)),r=Math.max(0,number(values.rate))/100,y=Math.max(0,number(values.years)),n=Math.max(0,number(values.months)),monthly=Math.max(0,number(values.monthly)),payment=Math.max(0,number(values.payment));
    if(id==='simple') { const interest=p*r*y;return {main:p+interest,caption:`Interest: ${money(interest)} · Principal: ${money(p)}`,details:`Simple interest = principal × rate × time.`}; }
    if(id==='compound') { const frequency={'Annually':1,'Semi-annually':2,'Quarterly':4,'Monthly':12,'Daily':365}[values.frequency]||12;const total=p*Math.pow(1+r/frequency,frequency*y);return {main:total,caption:`Estimated interest: ${money(total-p)} · ${frequency} compounding periods per year`,details:'Assumes a fixed annual nominal rate and no additional contributions or withdrawals.'}; }
    if(id==='savings') { const periods=Math.round(y*12);const rate=r/12;let total=p;for(let i=0;i<periods;i++)total=total*(1+rate)+monthly;const contributed=p+monthly*periods;return {main:total,caption:`Contributions: ${money(contributed)} · Illustrative growth: ${money(total-contributed)}`,details:'Monthly contributions are assumed at the end of each month; rate is held constant.'}; }
    if(id==='monthly') { const needed=Math.max(0,number(values.target)-Math.max(0,number(values.current)));const result=n>0?needed/n:0;return {main:result,caption:`Amount still needed: ${money(needed)} · ${n} months`,details:'No interest or investment returns are included.'}; }
    if(id==='loan'||id==='emi') { const rate=r/12;const months=n;const instalment=months>0?(rate===0?p/months:p*rate/(1-Math.pow(1+rate,-months))):0;const total=instalment*months;return {main:instalment,caption:`Total payments: ${money(total)} · Estimated interest: ${money(total-p)}`,details:`${months} monthly payments at a fixed annual rate of ${(r*100).toFixed(2)}%.`}; }
    if(id==='debt') { const monthlyRate=r/12;if(payment<=0)return {error:'Enter a monthly payment greater than zero.'};if(monthlyRate>0&&payment<=p*monthlyRate)return {error:'This payment does not exceed the estimated monthly interest, so the balance would not be paid off.'};let balance=p,totalInterest=0,months=0;while(balance>0&&months<1200){const interest=balance*monthlyRate;totalInterest+=interest;balance=Math.max(0,balance-(payment-interest));months++;}return {main:months,caption:`Estimated interest: ${money(totalInterest)} · Total paid: ${money(p+totalInterest)}`,details:'Assumes a fixed monthly payment, monthly interest calculation and no extra fees.'}; }
    if(id==='investment') { const total=p*Math.pow(1+r,y);return {main:total,caption:`Illustrative change: ${money(total-p)} · Assumed annual rate: ${(r*100).toFixed(2)}%`,details:'Hypothetical constant-rate estimate only. Real investments can fall in value and may not follow a constant return.'}; }
    return {error:'This calculator is not available.'};
  }
  function runCalculator(form) {
    const values=Object.fromEntries(new FormData(form).entries());
    for(const [key,value] of Object.entries(values)){if(key!=='frequency'&&(!Number.isFinite(Number(value))||Number(value)<0))return toast('Use valid non-negative numbers for the inputs.','error');}
    const result=calculate(activeCalculator,values);
    const box=$('#calculatorResult');
    if(result.error){box.innerHTML=`<span>CHECK YOUR INPUTS</span><strong style="font-size:15px">${esc(result.error)}</strong><p>Adjust the values and calculate again.</p>`;return;}
    const isMonths=activeCalculator==='debt';
    box.innerHTML=`<span>${isMonths?'ESTIMATED PAYOFF TIME':'ESTIMATED RESULT'}</span><strong>${isMonths?`${result.main} months`:money(result.main)}</strong><p>${esc(result.caption)}</p><p>${esc(result.details)}</p>`;
  }

  // --------------------------- Charts (native canvas; no chart library) ---------------------------
  function chartColors() {
    const css=getComputedStyle(document.body);
    return { green:css.getPropertyValue('--emerald').trim()||'#245943', gold:css.getPropertyValue('--gold').trim()||'#c5a66a', muted:css.getPropertyValue('--muted').trim()||'#829784', line:css.getPropertyValue('--line').trim()||'#e5e8df', text:css.getPropertyValue('--charcoal').trim()||'#26332d', palette:['#245943','#c5a66a','#829784','#6d8ca0','#a77d61','#8d7aa3','#b5a65f','#547e71','#c27f72','#91a8a0'] };
  }
  function canvasContext(canvas) {
    if(!canvas)return null;
    const rect=canvas.getBoundingClientRect();if(!rect.width)return null;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:rect.width,h:rect.height};
  }
  function chartEmpty(ctx,w,h,message='Add records to see your chart') {
    const c=chartColors();ctx.fillStyle=c.muted;ctx.font='11px DM Sans, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(message,w/2,h/2);
  }
  function lineChart(canvasId, labels, datasets, formatter = value => String(value)) {
    const canvas=$(`#${canvasId}`);const setup=canvasContext(canvas);if(!setup)return;
    const {ctx,w,h}=setup;const c=chartColors();ctx.clearRect(0,0,w,h);
    const left=42,right=10,top=12,bottom=25,chartW=w-left-right,chartH=h-top-bottom;
    const values=datasets.flatMap(d=>d.values).filter(Number.isFinite);if(!values.length||values.every(value=>value===0)){chartEmpty(ctx,w,h);return;}
    const max=Math.max(1,...values)*1.12;const min=Math.min(0,...values);const range=Math.max(1,max-min);
    ctx.font='9px DM Sans, sans-serif';ctx.textBaseline='middle';
    for(let i=0;i<4;i++){const y=top+chartH*i/3;ctx.strokeStyle=c.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle=c.muted;ctx.textAlign='right';ctx.fillText(formatter(max-(max-min)*i/3),left-7,y);}
    labels.forEach((label,i)=>{if(labels.length>7&&i%2)return;const x=left+(labels.length===1?chartW/2:i*chartW/Math.max(1,labels.length-1));ctx.fillStyle=c.muted;ctx.textAlign='center';ctx.fillText(label,x,h-9);});
    datasets.forEach(dataset=>{if(!dataset.values.length)return;ctx.strokeStyle=dataset.color;ctx.fillStyle=dataset.color;ctx.lineWidth=2.2;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();dataset.values.forEach((value,i)=>{const x=left+(labels.length===1?chartW/2:i*chartW/Math.max(1,labels.length-1));const y=top+chartH-(value-min)/range*chartH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();dataset.values.forEach((value,i)=>{const x=left+(labels.length===1?chartW/2:i*chartW/Math.max(1,labels.length-1));const y=top+chartH-(value-min)/range*chartH;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});});
  }
  function barChart(canvasId, labels, datasets, formatter = value => String(value)) {
    const canvas=$(`#${canvasId}`);const setup=canvasContext(canvas);if(!setup)return;
    const {ctx,w,h}=setup;const c=chartColors();ctx.clearRect(0,0,w,h);
    const values=datasets.flatMap(d=>d.values).filter(Number.isFinite);if(!values.length||values.every(value=>value===0)){chartEmpty(ctx,w,h);return;}
    const left=44,right=9,top=12,bottom=27,chartW=w-left-right,chartH=h-top-bottom;const max=Math.max(1,...values)*1.14;
    ctx.font='9px DM Sans, sans-serif';ctx.textBaseline='middle';
    for(let i=0;i<4;i++){const y=top+chartH*i/3;ctx.strokeStyle=c.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle=c.muted;ctx.textAlign='right';ctx.fillText(formatter(max*(1-i/3)),left-7,y);}
    const groupWidth=chartW/Math.max(1,labels.length);const innerWidth=Math.min(groupWidth*.72,42);const barWidth=Math.max(3,innerWidth/Math.max(1,datasets.length)-3);
    labels.forEach((label,index)=>{const center=left+groupWidth*(index+.5);ctx.fillStyle=c.muted;ctx.textAlign='center';ctx.fillText(label,center,h-10);datasets.forEach((dataset,datasetIndex)=>{const value=Math.max(0,number(dataset.values[index]));const barHeight=value/max*chartH;const x=center-innerWidth/2+datasetIndex*(barWidth+3);const y=top+chartH-barHeight;ctx.fillStyle=dataset.color;ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,barWidth,barHeight,Math.min(4,barWidth/2));else ctx.rect(x,y,barWidth,barHeight);ctx.fill();});});
  }
  function expenseCategoryTotals({month=null,year=null}={}) {
    const totals=new Map();
    state.transactions.filter(tx=>tx.currency===currentCurrency()&&['expense','refund'].includes(tx.type)&&(!month||tx.date?.startsWith(month))&&(!year||tx.date?.startsWith(String(year)))).forEach(tx=>{
      const name=tx.category||'Other';totals.set(name,(totals.get(name)||0)+(tx.type==='refund'?-number(tx.amount):number(tx.amount)));
    });
    return [...totals.entries()].map(([label,value])=>({label,value:round2(Math.max(0,value))})).filter(item=>item.value>0).sort((a,b)=>b.value-a.value);
  }
  function doughnutChart(canvasId,legendId,items,currency=currentCurrency()) {
    const canvas=$(`#${canvasId}`);const setup=canvasContext(canvas);if(!setup)return;
    const {ctx,w,h}=setup;const c=chartColors();ctx.clearRect(0,0,w,h);const total=sum(items,item=>item.value);const colors=items.map((_,i)=>c.palette[i%c.palette.length]);
    if(!items.length||total<=0){chartEmpty(ctx,w,h,'No expense categories yet');const legend=$(`#${legendId}`);if(legend)legend.innerHTML='<span class="tiny muted">Add expenses to build this chart.</span>';return;}
    const cx=w/2,cy=h/2,r=Math.min(w,h)*.39,inner=r*.63;let angle=-Math.PI/2;
    items.forEach((item,index)=>{const sweep=item.value/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+sweep);ctx.closePath();ctx.fillStyle=colors[index];ctx.fill();angle+=sweep;});
    ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--surface').trim()||'#fff';ctx.fill();
    ctx.fillStyle=c.text;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 12px Manrope, sans-serif';ctx.fillText(money(total,currency,0),cx,cy-5);ctx.fillStyle=c.muted;ctx.font='9px DM Sans, sans-serif';ctx.fillText('TOTAL SPEND',cx,cy+11);
    const legend=$(`#${legendId}`);if(legend)legend.innerHTML=items.map((item,index)=>`<div class="chart-legend-item" title="${esc(item.label)}"><i style="--legend-color:${colors[index]}"></i><span>${esc(item.label)}</span><strong>${(item.value/total*100).toFixed(0)}%</strong></div>`).join('');
  }
  function lastMonths(count) {
    return Array.from({length:count},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(count-1-i));return monthKey(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`);});
  }
  function compactAmount(value){return Math.abs(value)>=1000?`${(value/1000).toFixed(1)}k`:Math.round(value).toString();}
  function drawDashboardCharts() {
    const months=lastMonths(6);const labels=months.map(item=>new Date(`${item}-01T00:00:00`).toLocaleDateString(undefined,{month:'short'}));
    lineChart('cashFlowChart',labels,[{values:months.map(m=>monthIncome(m)),color:chartColors().green},{values:months.map(m=>monthExpenses(m)),color:chartColors().gold}],compactAmount);
    barChart('dashboardMonthlyBars',labels,[{values:months.map(m=>monthIncome(m)),color:chartColors().green},{values:months.map(m=>monthExpenses(m)),color:chartColors().gold}],compactAmount);
    doughnutChart('dashboardExpenseMix','dashboardExpenseLegend',expenseCategoryTotals({month:monthKey()}));
  }
  function drawExpenseChart() {
    const months=lastMonths(6);const labels=months.map(item=>new Date(`${item}-01T00:00:00`).toLocaleDateString(undefined,{month:'short'}));
    lineChart('expenseTrendChart',labels,[{values:months.map(m=>monthExpenses(m)),color:chartColors().gold}],compactAmount);
    doughnutChart('expenseCategoryPie','expenseCategoryLegend',expenseCategoryTotals({month:monthKey()}));
  }
  function drawReportCharts() {
    const months=Array.from({length:12},(_,index)=>`${activeReportYear}-${String(index+1).padStart(2,'0')}`);
    const labels=months.map(item=>new Date(`${item}-01T00:00:00`).toLocaleDateString(undefined,{month:'short'}));
    barChart('reportCashChart',labels,[{values:months.map(m=>monthIncome(m)),color:chartColors().green},{values:months.map(m=>monthExpenses(m)),color:chartColors().gold}],compactAmount);
    doughnutChart('reportExpensePie','reportExpenseLegend',expenseCategoryTotals({year:activeReportYear}));
    const snaps=state.snapshots.filter(item=>item.currency===currentCurrency()).sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
    lineChart('netWorthChart',snaps.map(item=>new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'short'})),[{values:snaps.map(item=>item.netWorth),color:chartColors().green}],compactAmount);
  }

  // --------------------------- Export, import and assistant ---------------------------
  function downloadFile(filename, content, type) {
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }
  function exportJSON() {
    const backup={...state,exportedAt:new Date().toISOString(),product:'FINANCE GROWTH'};
    downloadFile(`finance-growth-backup-${today()}.json`,JSON.stringify(backup,null,2),'application/json');toast('Your JSON backup is ready.');
  }
  function csvCell(value) { let text=String(value??'');if(/^[=+@\t\r]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`; }
  function exportCSV() {
    const headers=['Date','Type','Amount','Currency','Category','Account','Destination account','Payment method','Note'];
    const rows=state.transactions.map(tx=>{const account=state.accounts.find(a=>a.id===tx.accountId);const destination=state.accounts.find(a=>a.id===tx.toAccountId);return [tx.date,tx.type,tx.amount,tx.currency,tx.category,account?.name||'',destination?.name||'',tx.paymentMethod||'',tx.note||''];});
    const csv=[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');downloadFile(`finance-growth-transactions-${today()}.csv`,`\uFEFF${csv}`,'text/csv;charset=utf-8');toast('Transaction CSV exported.');
  }
  function importBackup(file) {
    if(!file)return;
    const reader=new FileReader();reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        const required=['accounts','transactions','budgets','goals','debts','debtPayments','investments'];
        if(!data||typeof data!=='object'||!required.every(key=>Array.isArray(data[key])))throw new Error('This file does not look like a FINANCE GROWTH backup.');
        if(!confirmAction('Import this backup and replace the records currently stored in this browser? Export your current data first if you may need it.'))return;
        const base=freshState();state={...base,...data,settings:{...base.settings,...(data.settings||{})},customExpenseCategories:Array.isArray(data.customExpenseCategories)?data.customExpenseCategories:[],completedLessons:Array.isArray(data.completedLessons)?data.completedLessons:[],snapshots:Array.isArray(data.snapshots)?data.snapshots:[]};
        delete state.exportedAt;delete state.product;addSnapshot();persist();render();toast('Backup imported successfully.');
      }catch(error){toast(error.message||'Could not import this backup.','error');}
    };reader.onerror=()=>toast('The selected file could not be read.','error');reader.readAsText(file);
  }
  function assistantResponse(question) {
    const q=question.toLowerCase();
    if(q.includes('compound'))return 'Compound interest is calculated on the original amount plus interest already added. Over time, that can create a compounding effect. Try the Compound Interest calculator with different rates and time periods.';
    if(q.includes('simple interest'))return 'Simple interest is calculated only on the original principal. A common formula is Principal × Annual Rate × Time, with time measured in years when the rate is annual.';
    if(q.includes('budget'))return 'A budget is a plan for how income may be used. Start with regular income and essential expenses, then plan flexible spending and savings. Review actual records and adjust the plan when circumstances change.';
    if(q.includes('snowball'))return 'The debt snowball method prioritizes the smallest remaining balance, while continuing required payments on other debts. It can create early milestones, although it may cost more interest than another strategy.';
    if(q.includes('avalanche'))return 'The debt avalanche method prioritizes the highest interest rate first. When the rates and fees are comparable, it can reduce the total interest paid over time.';
    if(q.includes('emergency'))return 'An emergency fund is a separate reserve for unexpected, necessary expenses. Start with a manageable target, keep it accessible, and build it gradually.';
    if(q.includes('diversif'))return 'Diversification means spreading investments across different holdings or asset types. It can reduce dependence on any one holding, but it cannot remove all investment risk.';
    if(q.includes('net worth'))return 'Net worth is the value of assets minus liabilities. Use consistent currencies and valuation dates, and avoid counting the same money twice.';
    if(q.includes('inflation'))return 'Inflation is a general increase in prices over time. When prices rise, the same amount of money generally buys fewer goods and services.';
    if(q.includes('invest'))return 'Investing involves putting money into assets with the possibility of growth or income, alongside the risk of loss. Understand the product, fees, liquidity and time horizon before making a decision.';
    if(q.includes('saving'))return 'A useful savings goal has a clear purpose, target amount and timeline. Divide what remains by the number of months to estimate a contribution plan, then review it as your situation changes.';
    return 'I can explain common topics such as budgeting, savings, compound interest, debt snowball and avalanche, net worth, inflation, diversification and basic investing. Try asking about one of those ideas.';
  }

  // --------------------------- Click and form event handling ---------------------------
  $('#startExploring').addEventListener('click',showApp);
  $('#authCard').addEventListener('click',event=>{const tab=event.target.closest('[data-auth-mode]');if(tab)showAuth(tab.dataset.authMode);});
  $('#authCard').addEventListener('submit',event=>{if(event.target.id==='signupForm'){event.preventDefault();submitSignup(event.target);}else if(event.target.id==='loginForm'){event.preventDefault();submitLogin(event.target);}});
  $('#returnWelcome').addEventListener('click',showWelcome);
  $('#brandHome').addEventListener('click',event=>{event.preventDefault();navigate('dashboard');});
  $('#profileButton').addEventListener('click',()=>{
    const menu = $('#profileMenu');
    const opening = menu.classList.contains('hidden');
    closeProfileMenu();
    if (opening) {
      menu.classList.remove('hidden');
      $('#profileButton').setAttribute('aria-expanded', 'true');
      menu.querySelector('[data-profile-action="settings"]')?.focus({ preventScroll: true });
    }
  });
  $('#profileMenu').addEventListener('click', event => {
    const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
    if (!action) return;
    closeProfileMenu();
    if (action === 'settings') navigate('settings');
    if (action === 'logout' && confirmAction('Sign out of this profile? Your account and saved financial records will remain on this device. You can sign in again or create another account.')) signOut();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.profile-menu-wrap')) closeProfileMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeProfileMenu();
  });
  $('#quickAddButton').addEventListener('click',()=>transactionForm('expense'));
  $('#menuToggle').addEventListener('click',()=>{ $('#sidebar').classList.add('open');$('#mobileScrim').classList.add('show'); });
  $('#closeSidebar').addEventListener('click',closeSidebar);
  $('#mobileScrim').addEventListener('click',closeSidebar);
  function closeSidebar(){ $('#sidebar').classList.remove('open');$('#mobileScrim').classList.remove('show'); }
  function navigate(view) { if(!viewMeta[view])return;currentView=view;closeSidebar();render();window.scrollTo({top:0,behavior:state.settings.reducedMotion?'auto':'smooth'}); }
  $('#sidebar').addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(button)navigate(button.dataset.view);});
  $('#modalClose').addEventListener('click',closeModal);
  modalBackdrop.addEventListener('click',event=>{if(event.target===modalBackdrop)closeModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modalBackdrop.classList.contains('hidden'))closeModal();});
  $('#modalBody').addEventListener('click',event=>{if(event.target.closest('[data-modal-cancel]'))closeModal();});

  $('#viewRoot').addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const {action,id}=button.dataset;
    const find=(collection)=>collection.find(item=>item.id===id);
    switch(action){
      case 'add-account':accountForm();break;
      case 'add-transfer':transactionForm('transfer',null,true);break;
      case 'add-expense':transactionForm('expense');break;
      case 'add-income':transactionForm('income');break;
      case 'add-goal':goalForm();break;
      case 'add-budget':budgetForm();break;
      case 'add-debt':debtForm();break;
      case 'add-investment':investmentForm();break;
      case 'edit-account':accountForm(find(state.accounts));break;
      case 'edit-transaction':{const tx=find(state.transactions);if(tx?.relatedInvestmentId||tx?.relatedDebtPaymentId){toast('This movement is linked to an investment or debt payment. Edit it from its own section.','info');break;}transactionForm('expense',tx);break;}
      case 'delete-transaction':{const tx=find(state.transactions);if(tx?.relatedInvestmentId||tx?.relatedDebtPaymentId){toast('This movement is linked to an investment or debt payment. Remove it from its own section to keep balances aligned.','info');break;}if(confirmAction('Delete this transaction? Account balances and reports will be recalculated.')){state.transactions=state.transactions.filter(item=>item.id!==id);commit('Transaction deleted.');}break;}
      case 'delete-account':{const used=state.transactions.some(tx=>tx.accountId===id||tx.toAccountId===id);if(used){toast('This account is linked to transaction history. Keep it to preserve your records.','info');break;}if(confirmAction('Delete this account?')){state.accounts=state.accounts.filter(item=>item.id!==id);commit('Account deleted.');}break;}
      case 'edit-goal':goalForm(find(state.goals));break;
      case 'contribute-goal':{const goal=find(state.goals);if(goal)contributeGoalForm(goal);break;}
      case 'delete-goal':if(confirmAction('Delete this goal and its contribution history? This will not change your account balances.')){state.goals=state.goals.filter(item=>item.id!==id);commit('Goal deleted.');}break;
      case 'edit-budget':budgetForm(find(state.budgets));break;
      case 'delete-budget':if(confirmAction('Delete this budget?')){state.budgets=state.budgets.filter(item=>item.id!==id);commit('Budget deleted.');}break;
      case 'edit-debt':debtForm(find(state.debts));break;
      case 'pay-debt':{const debt=find(state.debts);if(debt)payDebtForm(debt);break;}
      case 'delete-debt':{const hasPayments=state.debtPayments.some(item=>item.debtId===id);if(hasPayments){toast('This debt has payment history. Keep it to preserve your records.','info');break;}if(confirmAction('Delete this debt?')){state.debts=state.debts.filter(item=>item.id!==id);commit('Debt deleted.');}break;}
      case 'delete-debt-payment':if(confirmAction('Delete this payment record and restore its principal portion to the debt balance?')){const payment=find(state.debtPayments);if(payment){const debt=state.debts.find(item=>item.id===payment.debtId);if(debt)debt.remaining=round2(Math.min(debt.original,debt.remaining+payment.principal));if(payment.transactionId)state.transactions=state.transactions.filter(tx=>tx.id!==payment.transactionId);state.debtPayments=state.debtPayments.filter(item=>item.id!==id);commit('Payment removed, account outflow reversed and principal restored.');}}break;
      case 'estimate-debt':{const debt=find(state.debts);if(debt){const monthlyEquivalent=({Monthly:1,Weekly:52/12,Fortnightly:26/12,Quarterly:1/3,Other:1}[debt.frequency]||1)*debt.minimumPayment;const estimate=calculate('debt',{principal:debt.remaining,rate:debt.rate,payment:monthlyEquivalent});openModal(`Repayment estimate · ${debt.name}`,'ILLUSTRATIVE ESTIMATE',`<div class="calculator-result" style="margin-top:0"><span>ESTIMATED PAYOFF</span><strong>${estimate.error?'Cannot estimate':`${estimate.main} months`}</strong><p>${esc(estimate.error||estimate.caption)}</p><p>${esc(estimate.details||'Increase the payment above monthly interest to estimate payoff.')}</p></div><p class="small muted" style="margin:14px 0 0">Uses a monthly-equivalent payment based on the frequency you entered. Assumes monthly interest and no fees or missed payments.</p><div class="form-actions"><button class="button button-primary" type="button" data-modal-cancel>Close</button></div>`);}break;}
      case 'edit-investment':investmentForm(find(state.investments));break;
      case 'update-investment':{const item=find(state.investments);if(item)updateInvestmentForm(item);break;}
      case 'delete-investment':if(confirmAction('Delete this investment record and its valuation snapshots? Its linked contribution movement will also be reversed.')){state.transactions=state.transactions.filter(tx=>tx.relatedInvestmentId!==id);state.investments=state.investments.filter(item=>item.id!==id);commit('Investment deleted and linked account movement reversed.');}break;
      case 'choose-calculator':activeCalculator=id;render();break;
      case 'education-filter':activeEducationFilter=id;render();break;
      case 'open-lesson':{const lesson=lessons.find(item=>item.id===id);if(lesson){openModal(lesson.title,lesson.category.toUpperCase(),`<div class="lesson-body">${lesson.body}</div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Close</button><button class="button button-primary" type="button" id="markLessonRead">${state.completedLessons.includes(id)?'Marked as read':'Mark as read'}</button></div>`);$('#markLessonRead')?.addEventListener('click',()=>{if(!state.completedLessons.includes(id))state.completedLessons.push(id);persist();closeModal();render();toast('Knowledge plant updated.');});}break;}
      case 'goal-history':{const goal=find(state.goals);if(goal){const entries=(goal.history||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));openModal(`Contribution history · ${goal.name}`,'SAVINGS RECORD',`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Note</th><th>Amount</th></tr></thead><tbody>${entries.length?entries.map(item=>`<tr><td>${dateLabel(item.date)}</td><td>${esc(item.note||'—')}</td><td class="amount-positive">+ ${money(item.amount,goal.currency)}</td></tr>`).join(''):'<tr><td colspan="3">No contributions recorded.</td></tr>'}</tbody></table></div><div class="form-actions"><button class="button button-primary" type="button" data-modal-cancel>Close</button></div>`); }break;}
      case 'investment-history':{const item=find(state.investments);if(item){const entries=(item.snapshots||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));openModal(`Valuation history · ${item.name}`,'MANUAL VALUATION SNAPSHOTS',`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Entered valuation</th></tr></thead><tbody>${entries.length?entries.map(entry=>`<tr><td>${dateLabel(entry.date)}</td><td>${money(entry.value,item.currency)}</td></tr>`).join(''):'<tr><td colspan="2">No valuations recorded.</td></tr>'}</tbody></table></div><p class="tiny muted">These are values entered manually, not live market data.</p><div class="form-actions"><button class="button button-primary" type="button" data-modal-cancel>Close</button></div>`);}break;}
      case 'settings-tab':activeSettingsTab=id;render();break;
      case 'return-welcome-settings':showWelcome();break;
      case 'sign-out':if(confirmAction('Sign out of this local profile? Your saved records will remain on this browser.'))signOut();break;
      case 'set-accent':if(/^#[0-9a-f]{6}$/i.test(id||'')){state.settings.accent=id;persist();setTheme();render();toast('Accent colour updated.');}break;
      case 'reset-appearance':if(confirmAction('Restore the default theme, accent, typography, reading size, layout and visual effects? Your records and currency preference will stay unchanged.')){const defaults=freshState().settings;['theme','accent','font','textSize','layout','botanical','animations','reducedMotion'].forEach(key=>state.settings[key]=defaults[key]);commit('Appearance restored to defaults.');}break;
      case 'reset-preferences':if(confirmAction('Reset all preferences to their defaults? Your accounts, transactions, goals, budgets, debts and investments will remain unchanged.')){state.settings=freshState().settings;activeSettingsTab='appearance';commit('Preferences reset. Financial records were kept.');}break;
      case 'add-expense-category':openModal('Add an expense category','PERSONALIZE YOUR CATEGORIES',`<form><div class="form-grid">${field('Category name','name','','text','e.g. Pets or Subscriptions','required maxlength="35"')}</div><div class="form-actions"><button class="button button-quiet" type="button" data-modal-cancel>Cancel</button><button class="button button-primary" type="submit">Add category</button></div></form>`,data=>{const name=data.name.trim();if(!name)return toast('Enter a category name.','error'),false;if(allExpenseCategories().some(item=>item.toLowerCase()===name.toLowerCase()))return toast('That category already exists.','error'),false;state.customExpenseCategories.push(name);commit('Custom category added.');});break;
      case 'export-json':exportJSON();break;
      case 'export-csv':exportCSV();break;
      case 'reset-data':if(confirmAction('This permanently removes all FINANCE GROWTH records and preferences saved in this browser. Export a backup first if you may need it. Continue?')){state=freshState();activeSettingsTab='appearance';localStorage.removeItem(STORAGE_KEY);commit('Application data has been reset.');}break;
      case 'go-transactions':navigate('expenses');break;
      case 'navigate-goals':navigate('goals');break;
    }
  });

  $('#viewRoot').addEventListener('submit',event=>{
    if(event.target.id==='calculatorForm'){event.preventDefault();runCalculator(event.target);}
    if(event.target.id==='assistantForm'){event.preventDefault();const question=new FormData(event.target).get('question')||'';$('#assistantAnswer').innerHTML=`<div class="divider"></div><strong style="color:var(--emerald)">Growth Assistant</strong><p style="line-height:1.8;margin:6px 0 0">${esc(assistantResponse(question))}</p>`;}
  });
  $('#viewRoot').addEventListener('input',event=>{
    if(event.target.dataset.setting==='accent' && /^#[0-9a-f]{6}$/i.test(event.target.value)){
      state.settings.accent=event.target.value;
      setTheme();
    }
    if(event.target.id==='transactionSearch'){
      const query=event.target.value.toLowerCase();$$('#transactionRows tr').forEach(row=>row.classList.toggle('hidden',!!query&&!row.dataset.search?.includes(query)));
    }
    if(event.target.id==='glossarySearch'){
      const query=event.target.value.toLowerCase();$$('#glossaryList .glossary-item').forEach(row=>row.classList.toggle('hidden',!!query&&!row.dataset.search.includes(query)));
    }
  });
  $('#viewRoot').addEventListener('change',event=>{
    if(event.target.id==='reportYear'){activeReportYear=event.target.value;render();}
    if(event.target.id==='transactionMonth' || event.target.id==='transactionYear'){
      const month=$('#transactionMonth')?.value||'all';const year=$('#transactionYear')?.value||'all';
      const txs=state.transactions.filter(tx=>tx.currency===currentCurrency()&&(currentView==='income'?tx.type==='income':['expense','refund'].includes(tx.type))&&(month==='all'||tx.date.startsWith(month))&&(year==='all'||tx.date.startsWith(year))).sort((a,b)=>b.date.localeCompare(a.date));
      $('#transactionRows').innerHTML=tableRows(txs);
      const search=$('#transactionSearch')?.value.toLowerCase()||'';if(search) $$('#transactionRows tr').forEach(row=>row.classList.toggle('hidden',!!search&&!row.dataset.search?.includes(search)));
    }
    if(event.target.dataset.widget){
      const key=event.target.dataset.widget;
      state.settings.dashboardWidgets=state.settings.dashboardWidgets||{};
      state.settings.dashboardWidgets[key]=event.target.checked;
      persist();setTheme();
      toast('Dashboard layout saved.','info');
    }
    if(event.target.dataset.setting){
      const key=event.target.dataset.setting;
      const value=event.target.type==='checkbox'?event.target.checked:event.target.value;
      if(key.startsWith('widget-')){
        const widgetKey=key.slice(7);
        if(!['cashFlow','garden','recent','goals'].includes(widgetKey))return;
        state.settings.dashboardWidgets=state.settings.dashboardWidgets||{};
        state.settings.dashboardWidgets[widgetKey]=Boolean(value);
        persist();setTheme();toast('Dashboard layout saved.','info');
        return;
      }
      const allowed={theme:['light','dark','green','emerald','forest','system'],font:['manrope','inter','poppins','roboto','system'],textSize:['small','normal','large'],layout:['comfortable','compact'],currency:currencyOptions};
      if(key==='accent'&&!/^#[0-9a-f]{6}$/i.test(value)){toast('Choose a valid accent colour.','error');return;}
      if(allowed[key]&&!allowed[key].includes(value)){toast('That setting is not available.','error');return;}
      if(!['theme','font','textSize','layout','currency','accent','botanical','animations','reducedMotion'].includes(key))return;
      state.settings[key]=value;
      persist();setTheme();
      if(key==='currency'){
        addSnapshot();render();
        toast(`Display currency set to ${value}. Existing records keep their own currency.`,'info');
      } else {
        render();
        toast('Preference saved.','info');
      }
    }
    if(event.target.id==='backupFile')importBackup(event.target.files?.[0]);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.settings.theme === 'system') setTheme(); });

  // Each local profile loads its own financial workspace after sign-in.
  showAuth(getLocalUsers().length ? 'login' : 'signup');
})();
