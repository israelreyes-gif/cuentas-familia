/**
 * js/app.js
 * -----------------------------------------------------------------------
 * Punto de entrada de la app. Se encarga de:
 *   - inicializar los módulos de cada pestaña al cargar la página
 *   - la navegación entre pestañas (barra inferior)
 *
 * Depende de todos los demás módulos, así que debe cargarse el último
 * en index.html.
 * -----------------------------------------------------------------------
 */

const App = (function () {

  function showTab(name) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

    if (name === 'cat') {
      Categorias.showCatScreen('spend');
      document.getElementById('view-cat-spend').classList.add('active');
      UIHelpers.withOverlay(document.getElementById('catSpendList'), 300, () => {});
    } else if (name === 'mov') {
      document.getElementById('view-mov').classList.add('active');
      UIHelpers.withOverlay(document.getElementById('ledgerList'), 300, () => {});
    } else if (name === 'graf') {
      document.getElementById('view-graf').classList.add('active');
      Grafica.reset();
      UIHelpers.withOverlay(document.querySelector('.chart-wrap'), 300, () => {});
    }
  }

  function bindBottomNav() {
    document.querySelectorAll('.nav-btn').forEach(el => {
      el.addEventListener('click', () => showTab(el.dataset.tab));
    });
  }

  function init() {
    bindBottomNav();
    Movimientos.init();
    Categorias.init();
    Grafica.init();
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
