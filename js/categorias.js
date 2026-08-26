/**
 * js/categorias.js
 * -----------------------------------------------------------------------
 * Pestaña "Categorías": gasto del mes por categoría + administración
 * (añadir, editar presupuesto, eliminar).
 *
 * Depende de:
 *   - AppData     (js/data.js)        → leer/guardar categorías
 *   - UIHelpers   (js/ui-helpers.js)  → spinners y overlays de carga
 *   - Movimientos (js/movimientos.js) → SOLO para refrescar el <select>
 *     de categorías del formulario de movimientos cuando se añade,
 *     edita o borra una categoría aquí. Es la única dependencia cruzada
 *     entre módulos de pestaña; por eso en index.html movimientos.js
 *     debe cargarse antes que categorias.js.
 * -----------------------------------------------------------------------
 */

const Categorias = (function () {

  let selectedColor = AppData.getColorPalette()[0];

  // ---- utilidades internas ----

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  /** Evita inyectar HTML si el nombre de categoría contiene < > etc. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Escapa comillas simples para poder meter el nombre dentro de un onclick="...('nombre')". */
  function escapeJsString(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  // ---- pintado: gasto por categoría ----

  function renderSpendList() {
    const list = document.getElementById('catSpendList');
    if (!list) return;

    const cats = AppData.getCategoriasConGasto();
    if (cats.length === 0) {
      list.innerHTML = '<div class="empty-note">No hay gasto registrado este mes.</div>';
    } else {
      list.innerHTML = cats.map(c => {
        const sinPresupuesto = !c.presupuesto || c.presupuesto <= 0;
        const pct = sinPresupuesto ? 0 : Math.min(100, Math.round(c.gastado / c.presupuesto * 100));
        return `
          <div class="cat-row">
            <div class="cat-top">
              <div class="cat-name"><span class="cat-swatch" style="background:${c.color}"></span>${escapeHtml(c.nombre)}</div>
              <div class="cat-nums">${formatMoney(c.gastado)} ${sinPresupuesto ? '· sin presupuesto' : '/ ' + c.presupuesto + ' €'}</div>
            </div>
            <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${pct}%; background:${c.color}"></div></div>
          </div>
        `;
      }).join('');
    }

    renderMonthTotal(cats);
  }

  function renderMonthTotal(cats) {
    const el = document.getElementById('monthTotalAmt');
    if (!el) return;
    const total = (cats || AppData.getCategoriasConGasto()).reduce((sum, c) => sum + c.gastado, 0);
    el.textContent = formatMoney(total);
  }

  // ---- pintado: administrar categorías ----

  function renderManageList() {
    const el = document.getElementById('manageList');
    if (!el) return;

    const lista = AppData.getCategoriasOrdenadas();
    if (lista.length === 0) {
      el.innerHTML = '<div class="empty-note">No hay categorías todavía.</div>';
      return;
    }

    el.innerHTML = lista.map(c => `
      <div class="manage-row">
        <span class="cat-swatch" style="background:${c.color}"></span>
        <span class="name">${escapeHtml(c.nombre)}<br><span class="count">${c.movimientos} mov.</span></span>
        <span class="budget-field">
          <input type="number" value="${c.presupuesto || ''}" placeholder="0"
            onchange="Categorias.updateBudget('${escapeJsString(c.nombre)}', this.value, this)">
          <span class="spinner field-spinner"></span>
        </span>
        <button class="delete-btn" onclick="Categorias.deleteCategory('${escapeJsString(c.nombre)}', this)">✕</button>
      </div>
    `).join('');
  }

  function buildColorSwatches() {
    const el = document.getElementById('colorSwatches');
    if (!el) return;
    el.innerHTML = AppData.getColorPalette().map(c => `
      <div class="color-swatch ${c === selectedColor ? 'selected' : ''}" style="background:${c}" onclick="Categorias.selectColor('${c}')"></div>
    `).join('');
  }

  function selectColor(color) {
    selectedColor = color;
    buildColorSwatches();
  }

  // ---- navegación entre las dos pantallas de esta pestaña ----

  function showCatScreen(which) {
    document.getElementById('view-cat-spend').classList.remove('active');
    document.getElementById('view-cat-manage').classList.remove('active');
    if (which === 'manage') {
      document.getElementById('view-cat-manage').classList.add('active');
    } else {
      document.getElementById('view-cat-spend').classList.add('active');
    }
  }

  // ---- acciones ----

  function addCategory() {
    const input = document.getElementById('newCatName');
    const budgetInput = document.getElementById('newCatBudget');
    const btn = document.querySelector('.add-cat-btn');

    const nombre = input.value.trim();
    if (!nombre) return;

    if (AppData.categoriaExiste(nombre)) {
      input.style.borderColor = 'var(--expense)';
      return;
    }
    input.style.borderColor = '';

    const presupuesto = Math.max(0, parseFloat(budgetInput.value) || 0);

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    setTimeout(() => {
      AppData.addCategoria({ nombre, color: selectedColor, presupuesto });
      input.value = '';
      budgetInput.value = '';

      renderManageList();
      Movimientos.renderCategorySelect();
      UIHelpers.setButtonLoading(btn, false);
    }, 550);
  }

  function deleteCategory(nombre, btn) {
    if (btn) UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    setTimeout(() => {
      AppData.deleteCategoria(nombre);
      renderManageList();
      renderSpendList();
      Movimientos.renderCategorySelect();
    }, 400);
  }

  function updateBudget(nombre, valor, inputEl) {
    UIHelpers.withFieldLoading(inputEl, 450, () => {
      AppData.updateCategoriaPresupuesto(nombre, parseFloat(valor));
      renderSpendList();
    });
  }

  // ---- arranque del módulo ----

  function init() {
    buildColorSwatches();
    renderManageList();
    UIHelpers.withOverlay(document.getElementById('catSpendList'), 300, () => {
      renderSpendList();
    });
  }

  // ---- API pública del módulo ----
  return {
    init,
    renderSpendList,
    renderManageList,
    buildColorSwatches,
    selectColor,
    showCatScreen,
    addCategory,
    deleteCategory,
    updateBudget,
  };

})();
