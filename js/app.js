/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app. Al cambiar de pestaña por el menú inferior
 * (Movimiento/Categorías/Gráfica), la vista anterior gira como si fuera
 * una página de libro que se pasa, hacia el lado que corresponda según
 * si la pestaña nueva queda a la derecha o a la izquierda de la actual.
 * -----------------------------------------------------------------------
 */

const App = (function () {

  const ORDEN_TABS = ['mov', 'cat', 'graf'];

  /** A qué pestaña del menú inferior pertenece una vista (view-cat-manage cuenta como "cat"). */
  function tabDeVista(viewEl) {
    if (!viewEl) return null;
    if (viewEl.id === 'view-mov') return 'mov';
    if (viewEl.id === 'view-cat-spend' || viewEl.id === 'view-cat-manage') return 'cat';
    if (viewEl.id === 'view-graf') return 'graf';
    return null;
  }

  /** Los divs de sombra se crean solo una vez, la primera vez que a una vista le hace falta girar. */
  function asegurarSombras(view) {
    if (view.querySelector('.page-shade')) return;
    const shade = document.createElement('div');
    shade.className = 'page-shade';
    const shadeIn = document.createElement('div');
    shadeIn.className = 'page-shade-incoming';
    view.appendChild(shade);
    view.appendChild(shadeIn);
  }

  function limpiarFlip(view) {
    view.classList.remove('flip');
    view.style.transform = '';
    view.style.transformOrigin = '';
    view.style.zIndex = '';
    const shade = view.querySelector('.page-shade');
    const shadeIn = view.querySelector('.page-shade-incoming');
    if (shade) { shade.style.opacity = '0'; shade.style.background = ''; }
    if (shadeIn) { shadeIn.style.opacity = '0'; shadeIn.style.background = ''; }
  }

  /**
   * Gira `viejo` como una página que se pasa, revelando `nuevo` debajo.
   * Si no hay vista anterior, o no pertenecen a pestañas distintas del
   * menú inferior (ej. login→app, o Administrar↔Volver dentro de
   * Categorías), no hace nada especial y se queda con el fundido normal.
   */
  function animarCambioDeTab(viejo, nuevo, nombreNuevo) {
    if (!viejo || !nuevo || viejo === nuevo) return;

    const tabViejo = tabDeVista(viejo);
    if (tabViejo === null || tabViejo === nombreNuevo) return;

    const idxViejo = ORDEN_TABS.indexOf(tabViejo);
    const idxNuevo = ORDEN_TABS.indexOf(nombreNuevo);
    if (idxViejo === -1 || idxNuevo === -1) return;

    const vaHaciaLaDerecha = idxNuevo > idxViejo;

    asegurarSombras(viejo);
    asegurarSombras(nuevo);
    limpiarFlip(viejo);
    limpiarFlip(nuevo);

    // La vieja se vuelve a mostrar por encima mientras gira; la nueva queda debajo, ya visible.
    viejo.classList.add('active');
    viejo.style.zIndex = 2;
    nuevo.style.zIndex = 1;

    viejo.classList.add('flip');
    nuevo.classList.add('flip');

    // Bisagra a la izquierda si vamos hacia una pestaña de la derecha (como pasar hacia
    // adelante en un libro); a la derecha si vamos hacia una de la izquierda.
    const bisagraIzquierda = vaHaciaLaDerecha;
    viejo.style.transformOrigin = bisagraIzquierda ? 'left center' : 'right center';

    const sombraPropia = viejo.querySelector('.page-shade');
    const sombraProyectada = nuevo.querySelector('.page-shade-incoming');

    sombraPropia.style.background = bisagraIzquierda
      ? 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,.5) 100%)'
      : 'linear-gradient(to left, rgba(0,0,0,0) 0%, rgba(0,0,0,.5) 100%)';
    sombraProyectada.style.background = bisagraIzquierda
      ? 'linear-gradient(to right, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 42%)'
      : 'linear-gradient(to left, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 42%)';
    sombraProyectada.style.opacity = '1';

    void viejo.offsetWidth; // forzar reflow para que la transición arranque desde el estado inicial

    requestAnimationFrame(() => {
      viejo.style.transform = `rotateY(${bisagraIzquierda ? '-' : ''}180deg)`;
      sombraPropia.style.opacity = '1';
      sombraProyectada.style.opacity = '0';
    });

    setTimeout(() => {
      viejo.classList.remove('active');
      limpiarFlip(viejo);
      limpiarFlip(nuevo);
    }, 1000);
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
