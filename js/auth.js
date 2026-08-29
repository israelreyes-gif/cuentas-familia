/**
 * js/auth.js
 * -----------------------------------------------------------------------
 * Gestiona el login antes de poder usar la app.
 *
 * El token de sesión se guarda en localStorage (no cookies, porque la app
 * y la API viven en dominios distintos y las cookies entre dominios
 * distintos no funcionan bien aquí). Cada petición a la API lleva ese
 * token en la cabecera Authorization.
 * -----------------------------------------------------------------------
 */

const Auth = (function () {

  const API_BASE = 'https://cuentas-familia-api.israel-reyes.workers.dev';
  const TOKEN_KEY = 'cuentas_casa_token';

  let onSuccessCallback = null;

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function showLoginScreen() {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('view-login').classList.add('active');
    const nav = document.querySelector('.bottom-nav');
    if (nav) nav.classList.add('hidden');
  }

  /** Se llama al arrancar la app: si ya hay sesión guardada, entra directo; si no, muestra el login. */
  function boot(onSuccess) {
    onSuccessCallback = onSuccess;
    if (getToken()) {
      onSuccess();
    } else {
      showLoginScreen();
    }
  }

  /** Se llama cuando la API responde 401 (sesión caducada o no válida). */
  function forceLogout() {
    clearToken();
    showLoginScreen();
  }

  async function login() {
    const userInput = document.getElementById('loginUser');
    const passInput = document.getElementById('loginPass');
    const btn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');

    const username = userInput.value.trim();
    const password = passInput.value;
    errorEl.textContent = '';

    if (!username || !password) {
      errorEl.textContent = 'Escribe usuario y contraseña.';
      return;
    }

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner on-dark"></span> Entrando...');

    try {
      const res = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Usuario o contraseña incorrectos.');

      setToken(data.token);
      passInput.value = '';
      UIHelpers.setButtonLoading(btn, false);
      if (onSuccessCallback) onSuccessCallback();
    } catch (err) {
      UIHelpers.setButtonLoading(btn, false);
      errorEl.textContent = err.message || 'No se pudo iniciar sesión.';
    }
  }

  // ---- API pública del módulo ----
  return {
    boot,
    login,
    getToken,
    forceLogout,
  };

})();
