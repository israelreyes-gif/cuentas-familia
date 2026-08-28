/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app. Se encarga de:
 *   - cargar los datos reales desde la API (AppData.init())
 *   - la navegación entre pestañas (barra inferior)
 *   - pintar cada pestaña SOLO cuando se muestra, no todas al arrancar:
 *     así nunca se hace trabajo de más en una pestaña que el usuario
 *     no ha llegado a abrir, y cada vez que se entra en una pestaña se
 *     ve siempre lo último (sin tener que cerrar y volver a abrir la app)
 *   - registrar el service worker (PWA offline)
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

  function init() {
    bindBottomNav();
    registerServiceWorker();

    // Solo se inicializa la pestaña visible al arrancar (Movimiento).
    // Categorías y Gráfica se pintan la primera vez que el usuario las abre.
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

  // ---- API pública del módulo ----
  return {
    init,
    showTab,
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// --- SOLO DIAGNÓSTICO: quitar después ---
window.addEventListener('load', () => {
  setTimeout(() => {
    const campos = {
      'Importe': document.getElementById('amountInput'),
      'Categoría': document.getElementById('categorySelect'),
      'Descripción': document.getElementById('descInput'),
      'Fecha': document.querySelector('#view-mov input[type="date"]'),
    };
    let msg = '';
    for (const [nombre, el] of Object.entries(campos)) {
      if (el) msg += `${nombre}: ${el.getBoundingClientRect().height.toFixed(1)}px\n`;
    }
    alert(msg);
  }, 500);
});
