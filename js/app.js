/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app. Al cambiar de pestaña por el menú inferior
 * (Movimiento/Categorías/Gráfica), la vista anterior se desliza hacia un
 * lado y la nueva entra desde el otro, según si la pestaña nueva queda a
 * la derecha o a la izquierda de la actual.
 * -----------------------------------------------------------------------
 */

const App = (function () {

  const ORDEN_TABS = ['mov', 'cat', 'graf'];
  const DURACION_SLIDE_MS = 2000;

  /** A qué pestaña del menú inferior pertenece una vista (view-cat-manage cuenta como "cat"). */
  function tabDeVista(viewEl) {
    if (!viewEl) return null;
    if (viewEl.id === 'view-mov') return 'mov';
    if (viewEl.id === 'view-cat-spend' || viewEl.id === 'view-cat-manage') return 'cat';
    if (viewEl.id === 'view-graf') return 'graf';
    return null;
  }

  function limpiarSlide(view) {
    view.classList.remove('slide');
    view.style.transform = '';
    view.style.opacity = '';
  }

  /**
   * Desliza `viejo` fuera de la pantalla y `nuevo` entra desde el lado
   * contrario. Si no hay vista anterior, o no pertenecen a pestañas
   * distintas del menú inferior (ej. login→app, o Administrar↔Volver
   * dentro de Categorías), no hace nada especial y se queda con el
   * fundido normal.
   */
  function animarCambioDeTab(viejo, nuevo, nombreNuevo) {
    if (!viejo || !nuevo || viejo === nuevo) return;

    const tabViejo = tabDeVista(viejo);
    if (tabViejo === null || tabViejo === nombreNuevo) return;

    const idxViejo = ORDEN_TABS.indexOf(tabViejo);
    const idxNuevo = ORDEN_TABS.indexOf(nombreNuevo);
    if (idxViejo === -1 || idxNuevo === -1) return;

    const vaHaciaLaDerecha = idxNuevo > idxViejo;

    limpiarSlide(viejo);
    limpiarSlide(nuevo);

    viejo.classList.add('active', 'slide');
    nuevo.classList.add('slide');

    // La nueva arranca fuera de la pantalla, por el lado desde el que "entra".
    nuevo.style.transform = `translateX(${vaHaciaLaDerecha ? '100%' : '-100%'})`;
    nuevo.style.opacity = '1';
    nuevo.classList.add('active');

    void nuevo.offsetWidth; // forzar reflow para que la transición arranque desde el estado inicial

    requestAnimationFrame(() => {
      viejo.style.transform = `translateX(${vaHaciaLaDerecha ? '-100%' : '100%'})`;
      viejo.style.opacity = '0';
      nuevo.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
      viejo.classList.remove('active');
      limpiarSlide(viejo);
      limpiarSlide(nuevo);
    }, DURACION_SLIDE_MS);
  }

  function showTab(name) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));

    const viejo = document.querySelector('.view.active');
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

    let nuevo = null;

    if (name === 'mov') {
      nuevo = document.getElementById('view-mov');
      nuevo.classList.add('active');
      Movimientos.renderCategorySelect();
      Movimientos.resetDateField();
      Movimientos.renderHeader();
      Movimientos.renderLedgerList();
    } else if (name === 'cat') {
      Categorias.showCatScreen('spend');
      nuevo = document.getElementById('view-cat-spend');
    } else if (name === 'graf') {
      nuevo = document.getElementById('view-graf');
      nuevo.classList.add('active');
      Grafica.show();
    }

    animarCambioDeTab(viejo, nuevo, name);
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

  return {
    init,
    showTab,
    startApp,
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
