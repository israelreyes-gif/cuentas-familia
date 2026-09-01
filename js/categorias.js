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

  const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const RECURRENCIAS = [
    { value: 'mensual', label: 'Mes (mensual)' },
    { value: 'bimestral', label: '2 meses (bimestral)' },
    { value: 'trimestral', label: '3 meses (trimestral)' },
    { value: 'cuatrimestral', label: '4 meses (cuatrimestral)' },
    { value: 'semestral', label: '6 meses (semestral)' },
    { value: 'anual', label: 'Año (anual)' },
  ];

  function buildMesInicioOptions(seleccionado) {
    return MESES_LARGO.map((nombre, i) => {
      const valor = i + 1;
      return `<option value="${valor}" ${valor === seleccionado ? 'selected' : ''}>${nombre}</option>`;
    }).join('');
  }

  function buildRecurrenciaOptions(seleccionada) {
    return RECURRENCIAS.map(r =>
      `<option value="${r.value}" ${r.value === seleccionada ? 'selected' : ''}>${r.label}</option>`
    ).join('');
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
        ${c.fija ? `
          <div class="recur-block">
            <div class="recur-title">Recurrencia</div>
            <div class="recur-fields">
              <div class="mini-field">
                <label>Primer pago</label>
                <select onchange="Categorias.updateRecurrencia('${escapeJsString(c.nombre)}', this)">
                  ${buildMesInicioOptions(c.mes_inicio || 1)}
                </select>
              </div>
              <div class="mini-field">
                <label>Cada</label>
                <select onchange="Categorias.updateRecurrencia('${escapeJsString(c.nombre)}', this)">
                  ${buildRecurrenciaOptions(c.recurrencia || 'mensual')}
                </select>
              </div>
            </div>
          </div>
        ` : ''}
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
    const mesInicioInput = document.getElementById('newCatMesInicio');
    const recurrenciaInput = document.getElementById('newCatRecurrencia');
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
    const mesInicio = fija && mesInicioInput ? Number(mesInicioInput.value) : undefined;
    const recurrencia = fija && recurrenciaInput ? recurrenciaInput.value : undefined;

    UIHelpers.setButtonLoading(btn, true, '<span class="spinner"></span>');

    AppData.addCategoria({ nombre, color: selectedColor, presupuesto, fija, mesInicio, recurrencia })
      .then(() => {
        input.value = '';
        budgetInput.value = '';
        if (fijaInput) fijaInput.checked = false;
        toggleNewCatRecurBlock(false);
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
        Movimientos.renderCategorySelect();
        renderManageList();
      })
      .catch((err) => {
        checkboxEl.checked = !checked;
        checkboxEl.disabled = false;
        alert(err.message || 'No se pudo actualizar la categoría.');
      });
  }

  function updateRecurrencia(nombre, selectEl) {
    const bloque = selectEl.closest('.recur-block');
    const selects = bloque.querySelectorAll('select');
    const mesInicio = Number(selects[0].value);
    const recurrencia = selects[1].value;

    selects.forEach(s => s.disabled = true);
    AppData.updateCategoriaRecurrencia(nombre, recurrencia, mesInicio)
      .catch((err) => {
        alert(err.message || 'No se pudo actualizar la recurrencia.');
      })
      .finally(() => {
        selects.forEach(s => s.disabled = false);
      });
  }

  function toggleNewCatRecurBlock(checked) {
    const bloque = document.getElementById('newCatRecurBlock');
    if (!bloque) return;
    bloque.classList.toggle('hidden', !checked);
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
    updateRecurrencia,
    toggleNewCatRecurBlock,
  };

})();
