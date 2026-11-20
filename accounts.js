'use strict';

const accountProjectUrl = 'https://cdelycouqiparwsqwtxw.supabase.co';
const accountPublishableKey = 'sb_publishable_dXx41kBBxUDRga532XeHdw_5nt4ftLJ';
const accountSessionKey = 'diary-auth-cdely-v1';
const accountPreferenceKey = accountSessionKey + '-remember';
const knownAccountBrowserKey = accountSessionKey + '-known-browser';
const accountReturnUrl = 'https://rinagisha-droid.github.io/dnevnik-sostoyaniy-demo./';
const legacyDiaryKey = 'dnevnik_sostoyaniy_v1';
let accountClient;
let accountMode = 'login';
let accountOwner;
let verifiedAccount;
let accountIdentityVersion = 0;
let accountTransition = Promise.resolve();
let confirmationEmail = '';
let resendAfter = 0;
const accountCallbackParams = new URLSearchParams(location.hash.slice(1));
let recoveringAccount = accountCallbackParams.get('type') === 'recovery';
let confirmingAccount = accountCallbackParams.get('type') === 'signup';
let accountActionPending = false;
const accountMessage = document.getElementById('accountMessage');
const accountStatus = document.getElementById('authStatus');
const recoveryAccountForm = document.getElementById('accountRecoveryForm');
const resetAccountForm = document.getElementById('accountResetForm');
const rememberAccount = document.getElementById('rememberAccount');
const accountBar = document.getElementById('accountBar');
const accountHelp = document.getElementById('accountHelp');
accountHelp.addEventListener('click', () => {
  accountHelp.setAttribute('aria-expanded', String(accountHelp.getAttribute('aria-expanded') === 'false'));
});
const newVisitorControls = document.querySelectorAll('#diaryCover [data-new-visitor]');

function showReturningAccountCover() {
  newVisitorControls.forEach(control => { control.hidden = true; });
}

function restoreAccountCoverPreference() {
  try {
    if (localStorage.getItem(knownAccountBrowserKey) === 'yes'
        || Object.keys(localStorage).some(key => key.startsWith(legacyDiaryKey + '_account_'))) {
      showReturningAccountCover();
    }
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

function rememberKnownAccountBrowser() {
  showReturningAccountCover();
  try { localStorage.setItem(knownAccountBrowserKey, 'yes'); } catch {}
}

restoreAccountCoverPreference();

async function accountFetch(url, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function accountError(error) {
  if (error?.code === 'diary_pending') return error.message;
  if (error?.code === 'email_not_confirmed') return 'Подтвердите email по письму. Затем войдите с вашим паролем.';
  if (error?.status === 429) return 'Слишком много попыток. Подождите перед повторной отправкой.';
  if (error?.code === 'invalid_credentials') return 'Не удалось войти. Проверьте email и введите текущий пароль вручную: браузер мог подставить старый.';
  if (error?.code === 'user_already_exists') return 'Аккаунт уже существует. Войдите или восстановите пароль.';
  if (error?.code === 'weak_password') return 'Выберите более сложный пароль — не менее 12 символов.';
  if (error?.status >= 500) return 'Сервис не завершил запрос. Если ожидалось письмо, отправка не подтверждена. Попробуйте позже.';
  return 'Не удалось завершить действие. Проверьте подключение и повторите попытку.';
}

function showAccountForm(mode) {
  accountMode = mode;
  coverForm.reset();
  recoveryAccountForm.reset();
  resetAccountForm.reset();
  const signingUp = mode === 'signup';
  document.getElementById('accountExplanation').hidden = mode === 'login';
  signupProfile.hidden = !signingUp;
  signupProfile.disabled = !signingUp;
  coverForm.hidden = !['signup', 'login'].includes(mode);
  recoveryAccountForm.hidden = mode !== 'recovery';
  resetAccountForm.hidden = mode !== 'reset';
  coverPassword.autocomplete = signingUp ? 'new-password' : 'current-password';
  coverPassword.minLength = signingUp ? 12 : 1;
  rememberAccount.checked = localStorage.getItem(accountPreferenceKey) === 'yes';
  rememberAccount.closest('label').hidden = signingUp;
  document.getElementById('forgotAccount').hidden = signingUp;
  document.getElementById('accountBack').hidden = mode === 'reset';
  document.getElementById('accountTitle').textContent = {
    signup: 'Создать аккаунт', login: 'Войти', recovery: 'Восстановить доступ', reset: 'Новый пароль аккаунта'
  }[mode];
  document.getElementById('accountSubmit').textContent = signingUp ? 'Зарегистрироваться' : 'Войти';
  document.getElementById('resendAccountEmail').hidden = true;
  accountMessage.textContent = '';
  if (!coverDialog.open) coverDialog.showModal();
}

function hideAccountDiary() {
  stopDiaryDictation();
  document.body.dataset.cover = '';
  accountBar.hidden = true;
  accountHelp.setAttribute('aria-expanded', 'false');
}

async function selectDiaryStorage(owner) {
  await saveQueue;
  if (accountOwner === owner) {
    return;
  }
  if (savingFailed && !loadFailed && accountOwner !== undefined) {
    const error = Error('В предыдущем дневнике есть несохранённые правки. Вернитесь в тот аккаунт, скачайте черновик и обновите страницу.');
    error.code = 'diary_pending';
    throw error;
  }
  stopDiaryDictation();
  const nextKey = owner === 'legacy' ? legacyDiaryKey : legacyDiaryKey + '_account_' + owner;
  // Read and validate before switching; an unreadable diary is never replaced.
  const encrypted = localStorage.getItem(nextKey + '_encrypted');
  let entries = {};
  let invalidEntries = false;
  if (!encrypted) {
    try { entries = readDiaryEntries(JSON.parse(localStorage.getItem(nextKey) || '{}')); }
    catch { invalidEntries = true; }
  }
  storeKey = nextKey;
  encryptedStoreKey = nextKey + '_encrypted';
  data = entries;
  encryptionKey = null;
  vaultSalt = null;
  isVaultPresent = encrypted !== null;
  savingFailed = invalidEntries;
  loadFailed = invalidEntries;
  accountOwner = owner;
  date = new Date();
  date.setHours(12, 0, 0, 0);
  document.getElementById('vaultPassword').value = '';
  document.getElementById('vaultMessage').textContent = '';
  document.getElementById('vaultRecovery').classList.add('hidden');
  document.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; });
  rememberStorage();
  render();
  updatePrivacyUI();
  document.getElementById('app').classList.toggle('hidden', isVaultPresent || Date.now() >= config.cutoff);
  document.getElementById('vaultUnlock').classList.toggle('hidden', !isVaultPresent || Date.now() >= config.cutoff);
  document.getElementById('lock').classList.toggle('hidden', Date.now() < config.cutoff);
  saveStatus(invalidEntries
    ? 'Не удалось открыть записи. Исходное хранилище сохранено. Можно восстановить корректную копию в разделе «Мои записи».'
    : 'Записи сохраняются в этом браузере.');
}

function transitionToDiary(owner, user, version = accountIdentityVersion) {
  accountTransition = accountTransition.catch(() => {}).then(async () => {
    if (user && version !== accountIdentityVersion) return;
    hideAccountDiary();
    await selectDiaryStorage(owner);
    if (user && version !== accountIdentityVersion) return;
    document.getElementById('accountGreeting').textContent = user
      ? 'Здравствуйте, ' + (user.user_metadata?.given_name || user.email) + '!'
      : 'Локальный дневник этого браузера';
    const exitLabel = user ? 'Выйти' : 'На обложку';
    document.getElementById('accountSignOutText').textContent = exitLabel;
    document.getElementById('accountSignOut').setAttribute('aria-label', exitLabel);
    document.getElementById('accountStorageDesktop').textContent = user
      ? 'Это отдельный дневник аккаунта на этом устройстве. Прежние записи можно скачать в локальном дневнике и восстановить здесь из копии. Пароль локального шифрования может потребоваться отдельно.'
      : 'Прежние записи остаются в этом браузере. Для переноса в аккаунт скачайте копию, войдите и восстановите её в разделе «Мои записи».';
    document.getElementById('accountStorageMobile').textContent = user
      ? 'Записи аккаунта хранятся в этом браузере. Копию можно скачать в разделе «Мои записи».'
      : 'Записи без аккаунта хранятся в этом браузере. Копию можно скачать в разделе «Мои записи».';
    openLocalDiary();
    accountBar.hidden = false;
    window.scrollTo(0, 0);
  });
  return accountTransition;
}

async function openLegacyDiary() {
  try { await transitionToDiary('legacy', null); }
  catch (error) { accountStatus.textContent = error.message; }
}

function clearSignedOutView() {
  hideAccountDiary();
  if (!savingFailed) {
    data = {};
    encryptionKey = null;
    vaultSalt = null;
    render();
    accountOwner = undefined;
  }
  document.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; });
}

async function acceptAccountSession(session, version) {
  if (!session) {
    await saveQueue;
    if (version !== accountIdentityVersion) return;
    verifiedAccount = undefined;
    if (accountOwner === 'legacy' && !document.body.hasAttribute('data-cover')) return;
    clearSignedOutView();
    return;
  }
  const { data: result, error } = await accountClient.auth.getUser(session.access_token);
  if (version !== accountIdentityVersion) return;
  if (error || !result.user?.email_confirmed_at) {
    hideAccountDiary();
    accountStatus.textContent = 'Для входа нужна действующая сессия с подтверждённым email. Войдите снова.';
    return;
  }
  const alreadyOpen = accountOwner === result.user.id && !document.body.hasAttribute('data-cover');
  verifiedAccount = result.user;
  rememberKnownAccountBrowser();
  if (confirmingAccount) {
    confirmingAccount = false;
    await accountClient.auth.signOut({ scope: 'local' });
    showAccountForm('login');
    accountMessage.textContent = 'Email подтверждён. Войдите с вашим паролем. На личном устройстве можно сохранить вход.';
    return;
  }
  if (recoveringAccount) {
    if (accountMode === 'reset' && coverDialog.open) return;
    hideAccountDiary();
    showAccountForm('reset');
    return;
  }
  if (alreadyOpen || (accountOwner === 'legacy' && !document.body.hasAttribute('data-cover'))) return;
  await transitionToDiary(result.user.id, result.user, version);
}

async function runAccountAction(form, action) {
  if (accountActionPending) return;
  accountActionPending = true;
  coverDialog.inert = true;
  form.inert = true;
  document.getElementById('accountBack').disabled = true;
  try {
    await accountReady;
    if (!accountClient) throw Error('Клиент авторизации не загрузился.');
    await action();
  } catch (error) {
    accountMessage.textContent = accountError(error);
  } finally {
    form.inert = false;
    coverDialog.inert = false;
    accountActionPending = false;
    document.getElementById('accountBack').disabled = false;
  }
}

document.querySelectorAll('[data-account-mode]').forEach(button => {
  button.addEventListener('click', () => showAccountForm(button.dataset.accountMode));
});
document.getElementById('accountBack').addEventListener('click', () => coverDialog.close());
document.getElementById('forgotAccount').addEventListener('click', event => {
  event.preventDefault();
  const email = coverForm.elements.email.value;
  showAccountForm('recovery');
  document.getElementById('recoveryAccountEmail').value = email;
  document.getElementById('recoveryAccountEmail').focus();
});
document.getElementById('recoveryAccountBack').addEventListener('click', () => showAccountForm('login'));
coverDialog.addEventListener('close', () => {
  coverForm.reset();
  recoveryAccountForm.reset();
  resetAccountForm.reset();
});
coverDialog.addEventListener('cancel', event => {
  if (accountActionPending) event.preventDefault();
});

coverForm.addEventListener('submit', event => {
  event.preventDefault();
  const email = coverForm.elements.email.value.trim();
  const password = coverPassword.value;
  const signingUp = accountMode === 'signup';
  const profile = signingUp ? {
    given_name: coverForm.elements.givenName.value.trim(),
    family_name: coverForm.elements.familyName.value.trim(),
    ...(coverForm.elements.birthDate.value ? { birth_date: coverForm.elements.birthDate.value } : {}),
    ...(coverForm.elements.city.value.trim() ? { city: coverForm.elements.city.value.trim() } : {})
  } : undefined;
  if (signingUp && (!profile.given_name || !profile.family_name)) {
    accountMessage.textContent = 'Введите имя и фамилию.';
    return;
  }
  runAccountAction(coverForm, async () => {
    if (signingUp) {
      accountMessage.textContent = 'Отправляем запрос регистрации…';
      const { data: result, error } = await accountClient.auth.signUp({
        email, password, options: { data: profile, emailRedirectTo: accountReturnUrl }
      });
      if (error) throw error;
      if (result.session) {
        await accountClient.auth.signOut({ scope: 'local' });
        accountMessage.textContent = 'На сервере отключено подтверждение email. Настройка регистрации требует проверки.';
        return;
      }
      confirmationEmail = email;
      resendAfter = Date.now() + 60000;
      coverPassword.value = '';
      accountMessage.textContent = 'Запрос принят. Проверьте почту, включая «Спам». Подтвердите адрес по ссылке из письма, затем войдите. Если аккаунт уже создан, используйте вход или восстановление.';
      document.getElementById('resendAccountEmail').hidden = false;
    } else {
      if (rememberAccount.checked) localStorage.setItem(accountPreferenceKey, 'yes');
      else if (!localStorage.getItem(accountSessionKey)) localStorage.setItem(accountPreferenceKey, 'no');
      sessionStorage.setItem(accountPreferenceKey, rememberAccount.checked ? 'yes' : 'no');
      accountMessage.textContent = 'Входим…';
      const { data: result, error } = await accountClient.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === 'email_not_confirmed') {
          confirmationEmail = email;
          document.getElementById('resendAccountEmail').hidden = false;
        }
        throw error;
      }
      await acceptAccountSession(result.session, ++accountIdentityVersion);
    }
  });
});

document.getElementById('resendAccountEmail').addEventListener('click', event => {
  runAccountAction(event.currentTarget, async () => {
    if (Date.now() < resendAfter) {
      accountMessage.textContent = 'Повторить отправку можно через минуту после предыдущего запроса.';
      return;
    }
    const { error } = await accountClient.auth.resend({ type: 'signup', email: confirmationEmail, options: { emailRedirectTo: accountReturnUrl } });
    if (error) throw error;
    resendAfter = Date.now() + 60000;
    accountMessage.textContent = 'Запрос повторной отправки принят. Проверьте почту и папку «Спам».';
  });
});

recoveryAccountForm.addEventListener('submit', event => {
  event.preventDefault();
  const email = document.getElementById('recoveryAccountEmail').value.trim();
  runAccountAction(recoveryAccountForm, async () => {
    const { error } = await accountClient.auth.resetPasswordForEmail(email, { redirectTo: accountReturnUrl });
    if (error) throw error;
    accountMessage.textContent = 'Если аккаунт с этим адресом существует, на почту придёт письмо восстановления. Откройте его и задайте новый пароль.';
  });
});

resetAccountForm.addEventListener('submit', event => {
  event.preventDefault();
  const password = document.getElementById('newAccountPassword').value;
  if (password !== document.getElementById('repeatAccountPassword').value) {
    accountMessage.textContent = 'Пароли должны совпадать.';
    return;
  }
  runAccountAction(resetAccountForm, async () => {
    if (!recoveringAccount) throw Error('Сначала откройте письмо восстановления.');
    const { error } = await accountClient.auth.updateUser({ password });
    if (error) throw error;
    recoveringAccount = false;
    await accountClient.auth.signOut({ scope: 'local' });
    showAccountForm('login');
    accountMessage.textContent = 'Пароль аккаунта изменён. Войдите с новым паролем. Пароль прежнего локального шифрования остаётся отдельным.';
  });
});

document.getElementById('accountSignOut').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await saveQueue;
    if (savingFailed) {
      alert('Есть несохранённые правки. Скачайте черновик в разделе «Мои записи» перед выходом.');
      return;
    }
    if (accountClient && verifiedAccount) {
      const { error } = await accountClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    ++accountIdentityVersion;
    verifiedAccount = undefined;
    clearSignedOutView();
    accountStatus.textContent = 'Работа завершена. Сохранённые записи остались на устройстве.';
  } catch (error) {
    alert(accountError(error));
  } finally { button.disabled = false; }
});

const accountReady = (async () => {
  try {
    if (!window.supabase?.createClient) throw Error('SDK unavailable');
    // Email links start a temporary session; saving a login is an explicit login choice.
    if (accountCallbackParams.has('access_token')) sessionStorage.setItem(accountPreferenceKey, 'no');
    const sessionStorageChoice = () => {
      const remember = sessionStorage.getItem(accountPreferenceKey) ?? localStorage.getItem(accountPreferenceKey);
      return remember === 'yes' ? localStorage : sessionStorage;
    };
    accountClient = window.supabase.createClient(accountProjectUrl, accountPublishableKey, {
      global: { fetch: accountFetch },
      auth: {
        storageKey: accountSessionKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit',
        storage: {
          getItem: key => sessionStorageChoice().getItem(key),
          setItem: (key, value) => sessionStorageChoice().setItem(key, value),
          removeItem: key => sessionStorageChoice().removeItem(key)
        }
      }
    });
    accountClient.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      // BroadcastChannel events from another tab must not replace a tab-only session.
      let storedSession;
      try { storedSession = JSON.parse(sessionStorageChoice().getItem(accountSessionKey) || 'null'); }
      catch { storedSession = null; }
      if (session && storedSession?.access_token !== session.access_token) return;
      if (!session && storedSession) return;
      if (event === 'PASSWORD_RECOVERY') recoveringAccount = true;
      const version = ++accountIdentityVersion;
      queueMicrotask(() => {
        acceptAccountSession(session, version).catch(() => {
          hideAccountDiary();
          accountStatus.textContent = 'Не удалось открыть дневник аккаунта. Проверьте соединение и войдите снова.';
        });
      });
    });
    if (accountCallbackParams.has('error') || accountCallbackParams.has('error_description')) {
      history.replaceState(null, '', location.pathname + location.search);
      accountStatus.textContent = 'Ссылка подтверждения или восстановления недействительна либо истекла. Запросите новое письмо.';
      return;
    }
    const { data: result, error } = await accountClient.auth.getSession();
    if (error) throw error;
    if (result.session) await acceptAccountSession(result.session, ++accountIdentityVersion);
  } catch {
    accountStatus.textContent = 'Сервис аккаунтов недоступен. Проверьте подключение и попробуйте войти снова.';
  }
})();
