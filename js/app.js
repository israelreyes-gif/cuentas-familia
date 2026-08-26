/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app. Se encarga de:
 *   - cargar los datos reales desde la API (AppData.init())
 *   - inicializar los módulos de cada pestaña una vez cargados los datos
 *   - la navegación entre pestañas (barra inferior)
 *   - registrar el service worker (PWA offline)
 * -----------------------------------------------------------------------
 */

const App = (function () {

  function showTab(name) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

    if (name === 'cat') {
      Categorias.showCatScreen('spend');
      document.getElementById('view-cat-spend').classList.add('active');
    } else if (name === 'mov') {
      document.getElementById('view-mov').classList.add('active');
    } else if (name === 'graf') {
      document.getElementById('view-graf').classList.add('active');
      Grafica.reset();
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

  function init() {
    bindBottomNav();
    registerServiceWorker();

    AppData.init()
      .then(() => {
        Movimientos.init();
        Categorias.init();
        Grafica.init();
      })
      .catch((err) => {
        console.error('No se pudieron cargar los datos:', err);
        const ledger = document.getElementById('ledgerList');
        if (ledger) {
          ledger.innerHTML = '<div class="empty-note">No se pudo conectar con el servidor. Comprueba tu conexión y recarga la página.</div>';
        }
      });
  }

  // ---- API pública del módulo ----
  return {
    init,
    showTab,
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
