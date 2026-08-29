/**
 * js/categorias.js
 * -----------------------------------------------------------------------
 * Pestaña "Categorías": gasto del mes por categoría + administración
 * (añadir, editar presupuesto, marcar como fija, eliminar).
 * -----------------------------------------------------------------------
 */

const Categorias = (function () {

  let selectedColor = AppData.getColorPalette()[0];

  function formatMoney(valor) {
    return valor.toFixed(2).replace('.', ',') + ' €';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeJsString(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

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
              <div class="cat-name"><span class="cat-swatch" style="background:${c.color}"></span>${escapeHtml(c.nombre)}${c.fija ? ' <span class="fija-tag">Fija</span>' : ''}</div>
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
        <span class="name">
          ${escapeHtml(c.nombre)}<br>
          <span class="count">${c.movimientos} mov.</span>
          <label class="fija-check">
            <input type="checkbox" ${c.fija ? 'checked' : ''}
              onchange="Categorias.toggleFija('${escapeJsString(c.nombre)}', this.checked, this)"> Fija
          </label>
        </span>
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

  function showCatScreen(which) {
    document.getElementById('view-cat-spend').classList.remove('active');
    document.getElementById('view-cat-manage').classList.remove('active');

    if (which === 'manage') {
      document.getElementById('view-cat-manage').classList.add('active');
      buildColorSwatches();
      renderManageList();
    } else {
      document.getElementById('view-cat-spend').classList.add('active');
      renderSpendList();
    }
  }

  function addCategory() {
    const input = document.getElementById('newCatName');
    const budgetInput = document.getElementById('newCatBudget');
    const fijaInput = document.getElementById('newCatFija');
    const btn = document.querySelector('.add-cat-btn');

    const nombre = input.value.trim();
    if (!nombre) return;

    if (AppData.categoriaExiste(nombre)) {
      input.style.borderColor = 'var(--expense)';
      return;
    }
    input.style.borderColor = '';

    const presupuesto = Math.max(0, parseFloat(budgetInput.value) || 0);
    const fija = fijaInput ? fijaInput.checked : false;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    AppData.addCategoria({ nombre, color: selectedColor, presupuesto, fija })
      .then(() => {
        input.value = '';
        budgetInput.value = '';
        if (fijaInput) fijaInput.checked = false;
        renderManageList();
        Movimientos.renderCategorySelect();
      })
      .catch((err) => {
        input.style.borderColor = 'var(--expense)';
        alert(err.message || 'No se pudo crear la categoría.');
      })
      .finally(() => {
        UIHelpers.setButtonLoading(btn, false);
      });
  }

  function deleteCategory(nombre, btn) {
    if (btn) UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    AppData.deleteCategoria(nombre)
      .then(() => {
        renderManageList();
        renderSpendList();
        Movimientos.renderCategorySelect();
      })
      .catch((err) => {
        if (err.data && err.data.error === 'tiene_movimientos') {
          showReassignPrompt(nombre, err.data.count, btn);
        } else {
          if (btn) UIHelpers.setButtonLoading(btn, false);
          alert(err.message || 'No se pudo borrar la categoría.');
        }
      });
  }

  function showReassignPrompt(nombre, count, btn) {
    if (btn) UIHelpers.setButtonLoading(btn, false);
    const row = btn ? btn.closest('.manage-row') : null;
    if (!row) return;

    const otras = AppData.getCategoriasOrdenadas().filter(c => c.nombre !== nombre);
    if (otras.length === 0) {
      alert('No hay otra categoría a la que mover estos movimientos. Crea una nueva antes de borrar esta.');
      return;
    }

    row.insertAdjacentHTML('afterend', `
      <div class="reassign-row">
        <span class="reassign-note">${count} movimiento(s). Mover a:</span>
        <select class="reassign-select">
          ${otras.map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('')}
        </select>
        <button class="reassign-confirm" onclick="Categorias.confirmReassignDelete('${escapeJsString(nombre)}', this)">Mover y borrar</button>
        <button class="reassign-cancel" onclick="Categorias.cancelReassign(this)">Cancelar</button>
      </div>
    `);
  }

  function cancelReassign(btn) {
    const row = btn.closest('.reassign-row');
    if (row) row.remove();
  }

  function confirmReassignDelete(nombre, btn) {
    const row = btn.closest('.reassign-row');
    const select = row.querySelector('.reassign-select');
    const destino = select.value;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    AppData.deleteCategoria(nombre, destino)
      .then(() => {
        renderManageList();
        renderSpendList();
        Movimientos.renderCategorySelect();
      })
      .catch((err) => {
        UIHelpers.setButtonLoading(btn, false);
        alert(err.message || 'No se pudo mover y borrar la categoría.');
      });
  }

  function updateBudget(nombre, valor, inputEl) {
    UIHelpers.withFieldLoading(inputEl, 300, () => {});
    AppData.updateCategoriaPresupuesto(nombre, parseFloat(valor))
      .then(() => {
        renderSpendList();
      })
      .catch((err) => {
        alert(err.message || 'No se pudo actualizar el presupuesto.');
      });
  }

  function toggleFija(nombre, checked, checkboxEl) {
    checkboxEl.disabled = true;
    AppData.updateCategoriaFija(nombre, checked)
      .then(() => {
        checkboxEl.disabled = false;
        Movimientos.renderCategorySelect();
      })
      .catch((err) => {
        checkboxEl.checked = !checked;
        checkboxEl.disabled = false;
        alert(err.message || 'No se pudo actualizar la categoría.');
      });
  }

  return {
    renderSpendList,
    renderManageList,
    buildColorSwatches,
    selectColor,
    showCatScreen,
    addCategory,
    deleteCategory,
    cancelReassign,
    confirmReassignDelete,
    updateBudget,
    toggleFija,
  };

})();
