/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app.
 * -----------------------------------------------------------------------
 */

const App = (function () {

  function showTab(name) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

    if (name === 'mov') {
      document.getElementById('view-mov').classList.add('active');
      Movimientos.renderCategorySelect();
      Movimientos.renderHeader();
      Movimientos.renderLedgerList();
    } else if (name === 'cat') {
      Categorias.showCatScreen('spend');
    } else if (name === 'graf') {
      document.getElementById('view-graf').classList.add('active');
      Grafica.show();
    }
  }

  function bindBottomNav() {
    document.querySelectorAll('.nav-btn').forEach(el => {
      el.addEventListener('click', () => showTab(el.dataset.tab));
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }

  /** Se llama solo tras iniciar sesión correctamente (o si ya había una sesión guardada). */
  function startApp() {
    document.getElementById('view-login').classList.remove('active');
    document.querySelector('.bottom-nav').classList.remove('hidden');
    document.getElementById('view-mov').classList.add('active');

    AppData.init()
      .then(() => {
        Movimientos.init();
      })
      .catch((err) => {
        console.error('No se pudieron cargar los datos:', err);
        const ledger = document.getElementById('ledgerList');
        if (ledger) {
          ledger.innerHTML = '<div class="empty-note">No se pudo conectar con el servidor. Comprueba tu conexión y recarga la página.</div>';
        }
      });
  }

  function init() {
    bindBottomNav();
    registerServiceWorker();
    Auth.boot(startApp);
  }

  // ---- API pública del módulo ----
  return {
    init,
    showTab,
    startApp,
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
