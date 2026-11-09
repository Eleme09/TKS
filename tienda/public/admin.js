(function () {
  'use strict';

  const el = {
    authSection: document.getElementById('authSection'),
    authTitle: document.getElementById('authTitle'),
    authForm: document.getElementById('authForm'),
    fieldDisplayName: document.getElementById('fieldDisplayName'),
    displayName: document.getElementById('displayName'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    authSubmit: document.getElementById('authSubmit'),
    authError: document.getElementById('authError'),
    panelSection: document.getElementById('panelSection'),
    btnLogout: document.getElementById('btnLogout'),
    btnCerrarQuincena: document.getElementById('btnCerrarQuincena'),
    cierrePendiente: document.getElementById('cierrePendiente'),
    cierresLista: document.getElementById('cierresLista'),
    desprPersona: document.getElementById('desprPersona'),
    desprLista: document.getElementById('desprLista'),
    personaForm: document.getElementById('personaForm'),
    personaNombre: document.getElementById('personaNombre'),
    personaPin: document.getElementById('personaPin'),
    personasBody: document.getElementById('personasBody'),
    productoForm: document.getElementById('productoForm'),
    productoNombre: document.getElementById('productoNombre'),
    productoFoto: document.getElementById('productoFoto'),
    productoFotoFile: document.getElementById('productoFotoFile'),
    productoFotoPreview: document.getElementById('productoFotoPreview'),
    productoPrecio: document.getElementById('productoPrecio'),
    productoStock: document.getElementById('productoStock'),
    productosGrid: document.getElementById('productosGrid'),
    productosBuscar: document.getElementById('productosBuscar'),
    productosVacio: document.getElementById('productosVacio'),
    negocioForm: document.getElementById('negocioForm'),
    negocioNombre: document.getElementById('negocioNombre'),
    negocioMoneda: document.getElementById('negocioMoneda'),
  };

  let isSetupMode = false;
  let productosCache = [];

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
    } catch (e) {
      return `$${Math.round(value).toLocaleString('es-CO')}`;
    }
  }

  async function apiFetch(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  }

  function showPanel() {
    el.authSection.hidden = true;
    el.panelSection.hidden = false;
    el.btnLogout.hidden = false;
    loadCierres();
    loadPersonas();
    loadProductos();
    loadNegocio();
  }

  function showAuth() {
    el.authSection.hidden = false;
    el.panelSection.hidden = true;
    el.btnLogout.hidden = true;
  }

  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.authError.hidden = true;
    const username = el.username.value.trim();
    const password = el.password.value;
    try {
      if (isSetupMode) {
        await apiFetch('/api/admin/setup-first-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, display_name: el.displayName.value.trim() || null }),
        });
      } else {
        await apiFetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
      }
      showPanel();
    } catch (err) {
      el.authError.textContent = err.message;
      el.authError.hidden = false;
    }
  });

  el.btnLogout.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    showAuth();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // ── Utilidades ───────────────────────────────────────────────────────

  function downloadCsv(filename, rows) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Cierres de quincena ─────────────────────────────────────────────

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function labelQuincena(inicio, fin) {
    const [y, m, d1] = inicio.split('-').map(Number);
    return `${d1} al ${Number(fin.slice(8))} ${MESES[m - 1]} ${y}`;
  }

  // Última quincena ya terminada (hora Colombia), en YYYY-MM-DD.
  function ultimaQuincenaTerminada() {
    const hoy = new Date(Date.now() - 5 * 3600 * 1000);
    const y = hoy.getUTCFullYear();
    const m = hoy.getUTCMonth();
    const pad = (n) => String(n).padStart(2, '0');
    if (hoy.getUTCDate() <= 15) {
      const prev = new Date(Date.UTC(y, m, 0));
      return { inicio: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-16`, fin: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}` };
    }
    return { inicio: `${y}-${pad(m + 1)}-01`, fin: `${y}-${pad(m + 1)}-15` };
  }

  let cierresCache = [];

  // Selector de personas, por orden alfabético.
  function refreshDesprSelect() {
    const prev = el.desprPersona.value;
    el.desprPersona.innerHTML = personasCache
      .map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`)
      .join('');
    const existe = personasCache.some((p) => String(p.id) === prev);
    el.desprPersona.value = existe ? prev : personasCache.length ? String(personasCache[0].id) : '';
    loadDesprendibles();
    renderPersonas();
    loadConsumoPersona();
  }

  async function loadCierres() {
    cierresCache = await apiFetch('/api/admin/cierres');
    const q = ultimaQuincenaTerminada();
    const yaCerrada = cierresCache.some((c) => c.periodo_inicio === q.inicio && c.periodo_fin === q.fin);
    el.btnCerrarQuincena.hidden = yaCerrada;
    el.cierrePendiente.textContent = yaCerrada
      ? 'La última quincena terminada ya está cerrada.'
      : `Pendiente por cerrar: ${labelQuincena(q.inicio, q.fin)}.`;
    if (!yaCerrada) {
      el.btnCerrarQuincena.textContent = `Cerrar quincena ${labelQuincena(q.inicio, q.fin)}`;
      el.btnCerrarQuincena.dataset.inicio = q.inicio;
      el.btnCerrarQuincena.dataset.fin = q.fin;
    }
    // Cada cierre es un desplegable: al abrirlo salen los nombres; elegir uno muestra su cuenta abajo.
    el.cierresLista.innerHTML =
      cierresCache
        .map((c) => {
          const filas = c.detalle.filter((r) => Number(r.total) > 0).sort((a, b) => b.total - a.total);
          const nombres = filas
            .map(
              (r) =>
                `<button type="button" class="nombre-fila" data-ir="${r.persona_id}"><span>${escapeHtml(r.persona_nombre)}</span><span>${formatMoney(r.total)}</span></button>`
            )
            .join('');
          return `<details class="cierre-resumen">
            <summary><span><strong>${labelQuincena(c.periodo_inicio, c.periodo_fin)}</strong><br /><span class="muted">Total ${formatMoney(c.total)}</span></span></summary>
            <div class="nombres">${nombres || '<p class="muted">Sin consumos.</p>'}</div>
            <button type="button" class="btn btn-sm" data-csv="${c.id}">Exportar CSV</button></details>`;
        })
        .join('') || '<p class="muted">Aún no hay quincenas cerradas.</p>';

    el.cierresLista.querySelectorAll('[data-ir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.desprPersona.value = btn.dataset.ir;
        el.cierresLista.querySelectorAll('.nombre-fila').forEach((b) => b.classList.toggle('sel', b.dataset.ir === btn.dataset.ir));
        loadDesprendibles();
        renderPersonas();
        document.getElementById('personaBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    el.cierresLista.querySelectorAll('[data-csv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = cierresCache.find((x) => x.id === Number(btn.dataset.csv));
        downloadCsv(`cierre_${c.periodo_inicio}_${c.periodo_fin}.csv`, [
          ['Persona', 'Items', 'Total'],
          ...c.detalle.map((r) => [r.persona_nombre, r.items, r.total]),
        ]);
      });
    });
    if (personasCache.length) refreshDesprSelect();
  }

  // Desprendible de la persona elegida: consumo quincena a quincena.
  const ESTADO_DESPR = { en_curso: 'En curso', sin_cerrar: 'Sin cerrar', cerrada: 'Cerrada' };

  async function loadDesprendibles() {
    const id = el.desprPersona.value;
    if (!id) {
      el.desprLista.innerHTML = '<p class="muted">Aún no hay personas.</p>';
      return;
    }
    try {
      const data = await apiFetch(`/api/admin/personas/${id}/desprendibles`);
      const nombre = el.desprPersona.selectedOptions[0].textContent.split(' · ')[0];
      el.desprLista.innerHTML =
        data
          .map((q, i) => {
            const lineas = q.lineas
              .map(
                (l) =>
                  `<div class="linea${l.anulado ? ' anulada' : ''}"><span class="linea-fecha">${new Date(l.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span><span class="linea-prod">${escapeHtml(l.producto)} ×${l.cantidad}</span><span class="linea-monto">${formatMoney(l.subtotal)}</span></div>`
              )
              .join('');
            const abierta = false;
            return `<details class="desp-q"${abierta ? ' open' : ''}><summary><span><strong>${labelQuincena(q.inicio, q.fin)}</strong> <span class="muted">${ESTADO_DESPR[q.estado]}</span></span><strong>${formatMoney(q.total)}</strong></summary>
              <div class="lineas">${lineas}</div>
              <button type="button" class="btn btn-sm" data-despr-csv="${i}">Exportar CSV</button></details>`;
          })
          .join('') || '<p class="muted">Sin consumos registrados.</p>';
      el.desprLista.querySelectorAll('[data-despr-csv]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const q = data[Number(btn.dataset.desprCsv)];
          downloadCsv(`desprendible_${nombre}_${q.inicio}.csv`.replace(/\s+/g, '_'), [
            ['Fecha', 'Producto', 'Cantidad', 'Precio', 'Subtotal', 'Anulado'],
            ...q.lineas.map((l) => [new Date(l.fecha).toLocaleDateString('es-CO'), l.producto, l.cantidad, l.precio_unitario, l.subtotal, l.anulado ? 'Sí' : 'No']),
            ['', '', '', 'Total', q.total, ''],
          ]);
        });
      });
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  }

  el.desprPersona.addEventListener('change', () => {
    loadDesprendibles();
    renderPersonas();
    loadConsumoPersona();
  });
  document.getElementById('consumoDet').addEventListener('toggle', loadConsumoPersona);

  el.btnCerrarQuincena.addEventListener('click', async () => {
    const { inicio, fin } = el.btnCerrarQuincena.dataset;
    if (!window.confirm(`¿Cerrar la quincena ${labelQuincena(inicio, fin)}? Queda congelada y no se puede repetir.`)) return;
    el.btnCerrarQuincena.disabled = true;
    try {
      await apiFetch('/api/admin/cierres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inicio, fin }),
      });
      window.VW_UI.toast('Quincena cerrada', 'success');
      await loadCierres();
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    } finally {
      el.btnCerrarQuincena.disabled = false;
    }
  });

  // Dos motivos fijos, igual que en el autoservicio — acá el dueño puede
  // anular sin PIN y sin el límite de 15 minutos, para corregir un error
  // que se nota después.
  function elegirMotivoAnulacionAdmin() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'vw-modal-overlay';
      overlay.innerHTML = `
        <div class="vw-modal-box">
          <p>¿Por qué se anula este consumo?</p>
          <div class="vw-modal-actions" style="justify-content:stretch;flex-direction:column">
            <button type="button" class="btn btn-danger btn-block" data-tipo="no_hay">No había stock</button>
            <button type="button" class="btn btn-accent btn-block" data-tipo="no_quiere" style="margin-top:8px">No lo quiso</button>
            <button type="button" class="btn btn-block" id="btnCancelarMotivoAdmin" style="margin-top:8px">Cancelar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      function close(result) {
        overlay.remove();
        resolve(result);
      }
      overlay.querySelectorAll('[data-tipo]').forEach((btn) => {
        btn.addEventListener('click', () => close(btn.dataset.tipo));
      });
      overlay.querySelector('#btnCancelarMotivoAdmin').addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
    });
  }

  async function anularConsumoAdmin(consumoId) {
    const tipo = await elegirMotivoAnulacionAdmin();
    if (!tipo) return;
    try {
      await apiFetch(`/api/admin/consumos/${consumoId}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo }),
      });
      window.VW_UI.toast('Consumo anulado.', 'ok');
      await loadConsumoPersona();
      await loadDesprendibles();
      await loadProductos();
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  }

  // Consumo de la persona elegida: lista desplegable, solo se carga al abrirla.
  async function loadConsumoPersona() {
    const box = document.getElementById('consumoLista');
    const id = el.desprPersona.value;
    if (!id || !document.getElementById('consumoDet').open) return;
    try {
      const consumos = await apiFetch(`/api/admin/personas/${id}/consumos`);
      box.innerHTML =
        consumos
          .map((c) => {
            const fecha = new Date(c.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
            const total = formatMoney(Number(c.precio_unitario) * Number(c.cantidad));
            const prod = c.tf_productos ? c.tf_productos.nombre : '';
            return `<div class="linea consumo${c.anulado ? ' anulada' : ''}"><span class="linea-fecha">${fecha}</span><span class="linea-prod">${escapeHtml(prod)} ×${c.cantidad}${c.anulado ? `<br /><span class="muted">Anulado: ${escapeHtml(c.motivo_anulacion || '—')}</span>` : ''}</span><span class="linea-monto">${total}</span>${c.anulado ? '' : `<button type="button" class="btn btn-sm btn-quiet" data-anular-admin="${c.id}">Anular</button>`}</div>`;
          })
          .join('') || '<p class="muted">Sin consumos.</p>';
      box.querySelectorAll('[data-anular-admin]').forEach((btn) => {
        btn.addEventListener('click', () => anularConsumoAdmin(Number(btn.dataset.anularAdmin)));
      });
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  }

  // ── Personas ─────────────────────────────────────────────────────────

  let personasCache = [];

  async function loadPersonas() {
    personasCache = await apiFetch('/api/admin/personas');
    refreshDesprSelect();
  }

  // Acciones de la persona elegida (solo una a la vez, para no saturar la pantalla).
  function renderPersonas() {
    const p = personasCache.find((x) => String(x.id) === el.desprPersona.value);
    const box = document.getElementById('personaAcciones');
    const resumen = document.getElementById('personaResumen');
    if (!p) {
      box.innerHTML = '';
      resumen.innerHTML = '';
      return;
    }
    resumen.innerHTML = '';
    box.innerHTML = `<div class="muted" style="width:100%">${escapeHtml(p.nombre)} · ${p.activo ? 'Activa' : 'Inactiva'}</div>
        <button type="button" class="btn btn-sm" id="pEditar">Editar</button>
        <button type="button" class="btn btn-sm btn-quiet-danger" id="pVaciar">Vaciar lista</button>
        <button type="button" class="btn btn-sm btn-quiet-danger" id="pEliminar">Eliminar persona</button>`;
    document.getElementById('pEliminar').addEventListener('click', async () => {
      const ok = await window.VW_UI.confirmDialog(
        `¿Eliminar a ${p.nombre} para siempre? Se borran la persona y todos sus consumos. No se puede deshacer.`,
        { confirmLabel: 'Eliminar' }
      );
      if (!ok) return;
      try {
        await apiFetch(`/api/admin/personas/${p.id}`, { method: 'DELETE' });
        window.VW_UI.toast(`${p.nombre} eliminada.`, 'ok');
        await loadPersonas();
        loadCierres().catch(() => {});
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
    document.getElementById('pEditar').addEventListener('click', () => abrirEditarPersona(p));
    document.getElementById('pVaciar').addEventListener('click', async () => {
      const ok = await window.VW_UI.confirmDialog(
        `¿Vaciar la lista de ${p.nombre}? Se eliminan para siempre todos sus consumos. No se puede deshacer.`,
        { confirmLabel: 'Vaciar lista' }
      );
      if (!ok) return;
      try {
        const r = await apiFetch(`/api/admin/personas/${p.id}/vaciar`, { method: 'POST' });
        window.VW_UI.toast(`Lista de ${p.nombre} vaciada (${r.eliminados} consumos).`, 'ok');
        loadDesprendibles();
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
  }

  function abrirEditarPersona(persona) {
    const overlay = document.createElement('div');
    overlay.className = 'vw-modal-overlay';
    overlay.innerHTML = `
      <div class="vw-modal-box">
        <h2 style="margin:0 0 12px">Editar persona</h2>
        <div class="field">
          <label>Nombre</label>
          <input id="editPersonaNombre" value="${escapeHtml(persona.nombre)}" />
        </div>
        <div class="field">
          <label>Nuevo PIN (3 dígitos, dejar vacío para no cambiarlo)</label>
          <input id="editPersonaPin" maxlength="4" pattern="[0-9]{3,4}" />
        </div>
        <div class="field">
          <label><input type="checkbox" id="editPersonaActivo" ${persona.activo ? 'checked' : ''} style="width:auto;margin-right:6px" />Activa (puede entrar al autoservicio)</label>
        </div>
        <div class="vw-modal-actions">
          <button type="button" class="btn" id="btnCancelarEditPersona">Cancelar</button>
          <button type="button" class="btn btn-accent" id="btnGuardarPersona">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
    }
    overlay.querySelector('#btnCancelarEditPersona').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#btnGuardarPersona').addEventListener('click', async () => {
      const nombre = overlay.querySelector('#editPersonaNombre').value.trim();
      const pin = overlay.querySelector('#editPersonaPin').value.trim();
      const activo = overlay.querySelector('#editPersonaActivo').checked;
      try {
        await apiFetch(`/api/admin/personas/${persona.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, pin: pin || undefined, activo }),
        });
        close();
        await loadPersonas();
        window.VW_UI.toast('Persona actualizada.', 'ok');
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
  }

  el.personaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: el.personaNombre.value.trim(), pin: el.personaPin.value.trim() }),
      });
      el.personaForm.reset();
      await loadPersonas();
      window.VW_UI.toast('Persona agregada.', 'ok');
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  });

  // ── Productos ────────────────────────────────────────────────────────

  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  async function loadProductos() {
    productosCache = await apiFetch('/api/admin/productos');
    renderProductosAdmin();
  }

  // Catálogo compacto: tocar un producto abre su edición (activar, eliminar y demás van ahí).
  function renderProductosAdmin() {
    const q = normalizar(el.productosBuscar.value.trim());
    const lista = productosCache.filter((p) => !q || normalizar(p.nombre).includes(q));
    el.productosVacio.hidden = lista.length > 0;
    el.productosGrid.innerHTML = lista
      .map((p) => {
        const foto = p.foto_url ? `<img class="producto-foto" src="${escapeHtml(p.foto_url)}" alt="" loading="lazy" />` : '<div class="producto-foto-empty"></div>';
        return `<button type="button" class="producto-card admin-prod${p.activo ? '' : ' inactivo'}" data-editar-producto="${p.id}">
          ${foto}
          <div class="producto-body">
            <div class="producto-nombre">${escapeHtml(p.nombre)}</div>
            <div class="producto-precio">${formatMoney(p.precio)}</div>
            <div class="${Number(p.stock) <= 0 ? 'debe' : 'muted'} prod-stock">${p.activo ? `Stock ${p.stock}` : 'Inactivo'}</div>
          </div>
        </button>`;
      })
      .join('');
    el.productosGrid.querySelectorAll('[data-editar-producto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = productosCache.find((x) => x.id === Number(btn.dataset.editarProducto));
        if (p) abrirEditarProducto(p);
      });
    });
  }

  el.productosBuscar.addEventListener('input', renderProductosAdmin);

  async function alternarProducto(p) {
    await apiFetch(`/api/admin/productos/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !p.activo }),
    });
    await loadProductos();
  }

  async function eliminarProducto(p) {
    const ok = await window.VW_UI.confirmDialog(`¿Eliminar "${p.nombre}" para siempre? No se puede deshacer.`, { confirmLabel: 'Eliminar' });
    if (!ok) return false;
    try {
      await apiFetch(`/api/admin/productos/${p.id}`, { method: 'DELETE' });
      await loadProductos();
      window.VW_UI.toast('Producto eliminado.', 'ok');
      return true;
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
      return false;
    }
  }

  function abrirEditarProducto(producto) {
    const overlay = document.createElement('div');
    overlay.className = 'vw-modal-overlay';
    overlay.innerHTML = `
      <div class="vw-modal-box">
        <h2 style="margin:0 0 12px">Editar producto</h2>
        <div class="field">
          <label>Nombre</label>
          <input id="editProductoNombre" value="${escapeHtml(producto.nombre)}" />
        </div>
        <div class="field">
          <label>Precio</label>
          <input id="editProductoPrecio" type="number" min="0" value="${producto.precio}" />
        </div>
        <div class="field">
          <label>Stock</label>
          <input id="editProductoStock" type="number" min="0" value="${producto.stock}" />
        </div>
        <div class="field">
          <label>Foto</label>
          <div class="upload-row">
            <img id="editProductoFotoPreview" class="producto-foto" src="${escapeHtml(producto.foto_url || '')}" ${producto.foto_url ? '' : 'hidden'} />
            <input id="editProductoFoto" type="hidden" value="${escapeHtml(producto.foto_url || '')}" />
            <input id="editProductoFotoFile" type="file" accept="image/*" />
          </div>
        </div>
        <div class="persona-botones" style="margin-bottom:12px">
          <button type="button" class="btn btn-sm" id="btnToggleProducto">${producto.activo ? 'Desactivar' : 'Activar'}</button>
          <button type="button" class="btn btn-sm btn-quiet-danger" id="btnEliminarProducto">Eliminar</button>
        </div>
        <div class="vw-modal-actions">
          <button type="button" class="btn" id="btnCancelarEditProducto">Cancelar</button>
          <button type="button" class="btn btn-accent" id="btnGuardarProducto">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
    }
    overlay.querySelector('#btnCancelarEditProducto').addEventListener('click', close);
    overlay.querySelector('#btnToggleProducto').addEventListener('click', async () => {
      try {
        await alternarProducto(producto);
        close();
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
    overlay.querySelector('#btnEliminarProducto').addEventListener('click', async () => {
      if (await eliminarProducto(producto)) close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#editProductoFotoFile').addEventListener('change', async () => {
      const file = overlay.querySelector('#editProductoFotoFile').files[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/admin/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        overlay.querySelector('#editProductoFoto').value = data.url;
        const preview = overlay.querySelector('#editProductoFotoPreview');
        preview.src = data.url;
        preview.hidden = false;
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
    overlay.querySelector('#btnGuardarProducto').addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/productos/${producto.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: overlay.querySelector('#editProductoNombre').value.trim(),
            precio: Number(overlay.querySelector('#editProductoPrecio').value),
            stock: Number(overlay.querySelector('#editProductoStock').value),
            foto_url: overlay.querySelector('#editProductoFoto').value.trim() || null,
          }),
        });
        close();
        await loadProductos();
        window.VW_UI.toast('Producto actualizado.', 'ok');
      } catch (err) {
        window.VW_UI.toast(err.message, 'error');
      }
    });
  }

  el.productoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: el.productoNombre.value.trim(),
          precio: Number(el.productoPrecio.value),
          stock: Number(el.productoStock.value) || 0,
          foto_url: el.productoFoto.value.trim() || null,
        }),
      });
      el.productoForm.reset();
      el.productoFoto.value = '';
      el.productoFotoPreview.hidden = true;
      el.productoFotoPreview.src = '';
      await loadProductos();
      window.VW_UI.toast('Producto agregado.', 'ok');
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  });

  el.productoFotoFile.addEventListener('change', async () => {
    const file = el.productoFotoFile.files[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
      el.productoFoto.value = data.url;
      el.productoFotoPreview.src = data.url;
      el.productoFotoPreview.hidden = false;
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  });

  // ── Negocio ──────────────────────────────────────────────────────────

  async function loadNegocio() {
    const data = await apiFetch('/api/admin/negocio');
    el.negocioNombre.value = data.name || '';
    el.negocioMoneda.value = data.currency || 'COP';
  }

  el.negocioForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/negocio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: el.negocioNombre.value.trim(), currency: el.negocioMoneda.value.trim() }),
      });
      window.VW_UI.toast('Datos del negocio actualizados.', 'ok');
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────

  async function init() {
    const { needsSetup } = await apiFetch('/api/admin/needs-setup');
    isSetupMode = needsSetup;
    el.authTitle.textContent = needsSetup ? 'Crear cuenta del dueño' : 'Ingresar';
    el.authSubmit.textContent = needsSetup ? 'Crear cuenta' : 'Ingresar';
    el.fieldDisplayName.hidden = !needsSetup;

    const me = await apiFetch('/api/admin/me');
    if (me.username) showPanel();
    else showAuth();
  }

  init().catch((err) => console.error(err));
})();
