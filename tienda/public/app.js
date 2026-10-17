(function () {
  'use strict';

  const el = {
    businessName: document.getElementById('businessName'),
    stepPersona: document.getElementById('stepPersona'),
    personaGrid: document.getElementById('personaGrid'),
    stepPin: document.getElementById('stepPin'),
    pinPersonaName: document.getElementById('pinPersonaName'),
    pinForm: document.getElementById('pinForm'),
    pinInput: document.getElementById('pinInput'),
    deudaBanner: document.getElementById('deudaBanner'),
    deudaTexto: document.getElementById('deudaTexto'),
    btnSubirComprobante: document.getElementById('btnSubirComprobante'),
    comprobanteOverlay: document.getElementById('comprobanteOverlay'),
    comprobanteDetalle: document.getElementById('comprobanteDetalle'),
    comprobanteFile: document.getElementById('comprobanteFile'),
    comprobanteForm: document.getElementById('comprobanteForm'),
    comprobanteOk: document.getElementById('comprobanteOk'),
    comprobantePreview: document.getElementById('comprobantePreview'),
    btnComprobanteEnviar: document.getElementById('btnComprobanteEnviar'),
    btnComprobanteLuego: document.getElementById('btnComprobanteLuego'),
    btnBackPersona: document.getElementById('btnBackPersona'),
    stepMenu: document.getElementById('stepMenu'),
    menuPersonaName: document.getElementById('menuPersonaName'),
    productoList: document.getElementById('productoList'),
    historialLista: document.getElementById('historialLista'),
    quincenaLabel: document.getElementById('quincenaLabel'),
    quincenaTotal: document.getElementById('quincenaTotal'),
    btnSalir: document.getElementById('btnSalir'),
    carritoBar: document.getElementById('carritoBar'),
    carritoResumen: document.getElementById('carritoResumen'),
    btnAnotarTodo: document.getElementById('btnAnotarTodo'),
  };

  let business = null;
  let personas = [];
  let productos = [];
  let selectedPersona = null;
  let currentPin = null;
  const qtyByProducto = {};

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: business.currency || 'COP', maximumFractionDigits: 0 }).format(value);
    } catch (e) {
      return `$${Math.round(value).toLocaleString('es-CO')}`;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showStep(step) {
    el.stepPersona.hidden = step !== 'persona';
    el.stepPin.hidden = step !== 'pin';
    el.stepMenu.hidden = step !== 'menu';
  }

  function renderPersonas() {
    el.personaGrid.innerHTML = personas
      .map((p) => `<button type="button" class="persona-chip" data-id="${p.id}"><span class="neon-name">${escapeHtml(p.nombre)}</span></button>`)
      .join('');
    el.personaGrid.querySelectorAll('.persona-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedPersona = personas.find((p) => p.id === Number(btn.dataset.id));
        el.pinPersonaName.textContent = selectedPersona.nombre;
        el.pinInput.value = '';
        showStep('pin');
        el.pinInput.focus();
      });
    });
  }

  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const buscador = document.getElementById('productoBuscar');
  const vacio = document.getElementById('productoVacio');
  buscador.addEventListener('input', () => renderProductos());

  function renderProductos() {
    const q = normalizar(buscador.value.trim());
    const visibles = productos.filter((p) => !q || normalizar(p.nombre).includes(q));
    vacio.hidden = visibles.length > 0;
    el.productoList.innerHTML = visibles
      .map((p) => {
        const qty = qtyByProducto[p.id] || 0;
        const outOfStock = Number(p.stock) <= 0;
        const foto = p.foto_url
          ? `<img class="producto-foto" src="${escapeHtml(p.foto_url)}" alt="${escapeHtml(p.nombre)}" loading="lazy" />`
          : '<div class="producto-foto-empty"></div>';
        return `
          <article class="producto-card">
            ${foto}
            <div class="producto-body">
              <div class="producto-nombre">${escapeHtml(p.nombre)}</div>
              <div class="producto-precio">${formatMoney(p.precio)}</div>
              ${outOfStock ? '<span class="badge-out">Sin stock</span>' : ''}
              <div class="qty-controls">
                <button type="button" class="qty-btn" data-id="${p.id}" data-delta="-1" ${outOfStock ? 'disabled' : ''}>−</button>
                <span>${qty}</span>
                <button type="button" class="qty-btn" data-id="${p.id}" data-delta="1" ${outOfStock ? 'disabled' : ''}>+</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    el.productoList.querySelectorAll('.qty-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const delta = Number(btn.dataset.delta);
        const producto = productos.find((p) => p.id === id);
        const max = producto ? Number(producto.stock) : Infinity;
        qtyByProducto[id] = Math.min(max, Math.max(0, (qtyByProducto[id] || 0) + delta));
        renderProductos();
        renderCarritoBar();
      });
    });
  }

  // Todo lo elegido se anota junto, en un solo paso — no depende de que
  // alguien recuerde apretar "Anotar" producto por producto.
  function carritoItems() {
    return Object.entries(qtyByProducto)
      .filter(([, cantidad]) => cantidad > 0)
      .map(([productoId, cantidad]) => ({ productoId: Number(productoId), cantidad }));
  }

  function renderCarritoBar() {
    const items = carritoItems();
    if (items.length === 0) {
      el.carritoBar.hidden = true;
      return;
    }
    const totalItems = items.reduce((sum, it) => sum + it.cantidad, 0);
    const totalPrecio = items.reduce((sum, it) => {
      const producto = productos.find((p) => p.id === it.productoId);
      return sum + (producto ? producto.precio * it.cantidad : 0);
    }, 0);
    el.carritoResumen.textContent = `${totalItems} producto${totalItems === 1 ? '' : 's'} · ${formatMoney(totalPrecio)}`;
    el.carritoBar.hidden = false;
  }

  async function registrarTodo() {
    const items = carritoItems();
    if (items.length === 0 || el.btnAnotarTodo.disabled) return;
    el.btnAnotarTodo.disabled = true;
    try {
      const res = await fetch('/api/consumos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_id: selectedPersona.id,
          pin: currentPin,
          items: items.map((it) => ({ producto_id: it.productoId, cantidad: it.cantidad })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar');
      Object.keys(qtyByProducto).forEach((k) => delete qtyByProducto[k]);
      await refreshProductos();
      window.VW_UI.toast('Consumo anotado.', 'ok');
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    } finally {
      el.btnAnotarTodo.disabled = false;
    }
  }

  el.btnAnotarTodo.addEventListener('click', registrarTodo);

  async function refreshProductos() {
    productos = await fetch('/api/productos').then((r) => r.json());
    renderProductos();
    renderCarritoBar();
  }

  // Quincena colombiana estándar: 1-15 y 16-fin de mes (hora Colombia).
  const MESES_H = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function quincenaDe(fecha) {
    const d = new Date(new Date(fecha).getTime() - 5 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const primera = d.getUTCDate() <= 15;
    const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const desde = primera ? 1 : 16;
    const hasta = primera ? 15 : ultimo;
    return { key: `${y}-${String(m + 1).padStart(2, '0')}-${desde}`, label: `${desde} al ${hasta} ${MESES_H[m]} ${y}`, corta: `${desde} – ${hasta} ${MESES_H[m]}` };
  }

  function renderQuincena(consumos) {
    const actual = quincenaDe(Date.now());
    el.quincenaLabel.textContent = `Quincena actual (${actual.corta})`;
    const total = consumos
      .filter((c) => !c.anulado && quincenaDe(c.created_at).key === actual.key)
      .reduce((sum, c) => sum + Number(c.precio_unitario) * Number(c.cantidad), 0);
    el.quincenaTotal.textContent = formatMoney(total);
  }

  // Historial por quincenas: la actual abierta, las anteriores plegadas.
  async function loadHistorial() {
    const res = await fetch(`/api/personas/${selectedPersona.id}/consumos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona_id: selectedPersona.id, pin: currentPin }),
    });
    const data = await res.json();
    if (!res.ok) {
      window.VW_UI.toast(data.error || 'No se pudo cargar', 'error');
      return;
    }
    renderQuincena(data);
    const actualKey = quincenaDe(Date.now()).key;
    const grupos = new Map();
    for (const c of data) {
      const q = quincenaDe(c.created_at);
      if (!grupos.has(q.key)) grupos.set(q.key, { ...q, total: 0, lineas: [] });
      const g = grupos.get(q.key);
      const subtotal = Number(c.precio_unitario) * Number(c.cantidad);
      if (!c.anulado) g.total += subtotal;
      g.lineas.push({ c, subtotal });
    }
    if (!grupos.has(actualKey)) {
      const q = quincenaDe(Date.now());
      grupos.set(q.key, { ...q, total: 0, lineas: [] });
    }
    const orden = Array.from(grupos.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
    el.historialLista.innerHTML = orden
      .map((g) => {
        const esActual = g.key === actualKey;
        const filas = g.lineas
          .map(({ c, subtotal }) => {
            const fecha = new Date(c.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
            const nombre = c.tf_productos ? c.tf_productos.nombre : '';
            const dentroDePlazo = Date.now() - new Date(c.created_at).getTime() <= 15 * 60 * 1000;
            const anularBtn = c.anulado || !dentroDePlazo ? '' : `<button type="button" class="btn btn-sm btn-quiet" data-anular="${c.id}">Anular</button>`;
            return `<div class="linea consumo${c.anulado ? ' anulada' : ''}"><span class="linea-fecha">${fecha}</span><span class="linea-prod">${escapeHtml(nombre)} ×${c.cantidad}${c.anulado ? `<br /><span class="muted">Anulado: ${escapeHtml(c.motivo_anulacion || '—')}</span>` : ''}</span><span class="linea-monto">${formatMoney(subtotal)}</span>${anularBtn}</div>`;
          })
          .join('');
        return `<details class="desp-q"${esActual ? ' open' : ''}><summary><span><strong>${g.label}</strong>${esActual ? ' <span class="muted">Actual</span>' : ''}</span><strong>${formatMoney(g.total)}</strong></summary><div class="lineas" style="margin:0 12px 12px">${filas || '<p class="muted">Sin consumos todavía.</p>'}</div></details>`;
      })
      .join('');

    el.historialLista.querySelectorAll('[data-anular]').forEach((btn) => {
      btn.addEventListener('click', () => anularConsumo(Number(btn.dataset.anular)));
    });
  }

  // Dos motivos fijos, no texto libre: "no hay" es un error real de stock
  // (no se repone nada, el producto queda en 0 hasta recargar) y "no lo
  // quiere" es que la persona se arrepintió (el producto vuelve al stock).
  function elegirMotivoAnulacion() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'vw-modal-overlay';
      overlay.innerHTML = `
        <div class="vw-modal-box">
          <p>¿Por qué se anula este consumo?</p>
          <div class="vw-modal-actions" style="justify-content:stretch;flex-direction:column">
            <button type="button" class="btn btn-danger btn-block" data-tipo="no_hay">No había stock</button>
            <button type="button" class="btn btn-accent btn-block" data-tipo="no_quiere" style="margin-top:8px">No lo quiso</button>
            <button type="button" class="btn btn-block" id="btnCancelarMotivo" style="margin-top:8px">Cancelar</button>
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
      overlay.querySelector('#btnCancelarMotivo').addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
    });
  }

  async function anularConsumo(consumoId) {
    const tipo = await elegirMotivoAnulacion();
    if (!tipo) return;
    try {
      const res = await fetch(`/api/consumos/${consumoId}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPin, tipo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo anular');
      window.VW_UI.toast('Consumo anulado.', 'ok');
      await loadHistorial();
      await refreshProductos();
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
    }
  }


  // ── Comprobante de pago ──────────────────────────────────────────────
  // Tras cada cierre de quincena, quien debe ve el aviso (banner fijo + ventana
  // al entrar) hasta subir la foto de su comprobante; subirlo la marca pagada.
  let deudas = [];
  let comprobanteFile = null;

  const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function labelQ(d) {
    return `${Number(d.inicio.slice(8))} al ${Number(d.fin.slice(8))} ${MESES_C[Number(d.inicio.slice(5, 7)) - 1]}`;
  }

  async function loadDeudas({ abrir } = {}) {
    try {
      const res = await fetch(`/api/personas/${selectedPersona.id}/deudas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: selectedPersona.id, pin: currentPin }),
      });
      deudas = res.ok ? await res.json() : [];
    } catch (e) {
      deudas = [];
    }
    const d = deudas[0];
    el.deudaBanner.hidden = !d;
    if (!d) return;
    const total = deudas.reduce((s, x) => s + Number(x.total), 0);
    el.deudaTexto.textContent =
      deudas.length === 1
        ? `Quincena ${labelQ(d)} cerrada: debes ${formatMoney(total)}. Sube tu comprobante de pago.`
        : `Tienes ${deudas.length} quincenas por pagar (${formatMoney(total)}). Sube tu comprobante de pago.`;
    if (abrir) abrirComprobante();
  }

  function abrirComprobante() {
    const d = deudas[0];
    if (!d) return;
    comprobanteFile = null;
    el.comprobanteFile.value = '';
    el.comprobantePreview.hidden = true;
    el.btnComprobanteEnviar.disabled = true;
    el.comprobanteDetalle.textContent = `Quincena ${labelQ(d)}: ${formatMoney(d.total)}`;
    el.comprobanteForm.hidden = false;
    el.comprobanteOk.hidden = true;
    el.comprobanteOverlay.hidden = false;
  }

  document.getElementById('btnCopiarNequi').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('3105625283');
      window.VW_UI.toast('Número copiado', 'success');
    } catch (e) {
      window.VW_UI.toast('Número: 310 562 5283', 'success');
    }
  });

  // Reduce capturas/fotos grandes (máx. 1600 px, JPEG) antes de subir: pesan
  // ~200-500 KB en vez de varios MB, suben rápido con datos móviles y gastan
  // poco almacenamiento. Si el navegador no puede, se envía el original.
  async function comprimirImagen(file) {
    if (file.size < 600 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * escala);
      canvas.height = Math.round(bmp.height * escala);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], 'comprobante.jpg', { type: 'image/jpeg' });
    } catch (e) {
      return file;
    }
  }

  el.btnSubirComprobante.addEventListener('click', abrirComprobante);
  const cerrarComprobante = () => {
    el.comprobanteOverlay.hidden = true;
  };
  el.btnComprobanteLuego.addEventListener('click', cerrarComprobante);
  document.getElementById('btnComprobanteX').addEventListener('click', cerrarComprobante);
  el.comprobanteOverlay.addEventListener('click', (e) => {
    if (e.target === el.comprobanteOverlay) cerrarComprobante();
  });
  el.comprobanteFile.addEventListener('change', () => {
    comprobanteFile = el.comprobanteFile.files[0] || null;
    el.btnComprobanteEnviar.disabled = !comprobanteFile;
    if (comprobanteFile) {
      el.comprobantePreview.src = URL.createObjectURL(comprobanteFile);
      el.comprobantePreview.hidden = false;
    }
  });
  el.btnComprobanteEnviar.addEventListener('click', async () => {
    if (!comprobanteFile || !deudas[0]) return;
    el.btnComprobanteEnviar.disabled = true;
    const fd = new FormData();
    fd.append('pin', currentPin);
    fd.append('persona_id', selectedPersona.id);
    fd.append('cierre_id', deudas[0].cierre_id);
    fd.append('file', await comprimirImagen(comprobanteFile));
    try {
      const res = await fetch(`/api/personas/${selectedPersona.id}/comprobante`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir');
      window.VW_UI.toast('Comprobante recibido. Quincena pagada, ¡gracias!', 'success');
      el.comprobanteForm.hidden = true;
      el.comprobanteOk.hidden = false;
      await new Promise((r) => setTimeout(r, 1700));
      el.comprobanteOverlay.hidden = true;
      await loadDeudas({ abrir: false });
      if (deudas.length) abrirComprobante();
    } catch (err) {
      window.VW_UI.toast(err.message, 'error');
      el.btnComprobanteEnviar.disabled = false;
    }
  });

  el.pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = el.pinInput.value.trim();
    if (!/^\d{3,4}$/.test(pin)) {
      window.VW_UI.toast('El PIN debe tener 3 dígitos.', 'error');
      return;
    }
    // Se valida recién al primer POST (no hay endpoint de "solo validar PIN"
    // para no crear una vía extra de fuerza bruta) — probamos contra el
    // historial, que ya requiere PIN correcto.
    currentPin = pin;
    try {
      const res = await fetch(`/api/personas/${selectedPersona.id}/consumos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: selectedPersona.id, pin: currentPin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.VW_UI.toast(data.error || 'PIN incorrecto', 'error');
        return;
      }
      el.menuPersonaName.textContent = selectedPersona.nombre;
      Object.keys(qtyByProducto).forEach((k) => delete qtyByProducto[k]);
      await refreshProductos();
      showStep('menu');
      document.querySelector('.tab-btn[data-tab="tabAgregar"]').click();
      loadDeudas({ abrir: true });
    } catch (err) {
      window.VW_UI.toast('No se pudo conectar. Intenta de nuevo.', 'error');
    }
  });

  el.btnBackPersona.addEventListener('click', () => {
    selectedPersona = null;
    currentPin = null;
    showStep('persona');
  });

  el.btnSalir.addEventListener('click', () => {
    el.deudaBanner.hidden = true;
    el.comprobanteOverlay.hidden = true;
    selectedPersona = null;
    currentPin = null;
    showStep('persona');
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tabHistorial') loadHistorial();
    });
  });

  async function init() {
    const [businessRes, personasRes] = await Promise.all([
      fetch('/api/negocio').then((r) => r.json()),
      fetch('/api/personas').then((r) => r.json()),
    ]);
    business = businessRes;
    personas = personasRes;
    el.businessName.textContent = business.name || 'Autoservicio';
    document.title = business.name || 'Autoservicio';
    renderPersonas();
  }

  init().catch((err) => {
    console.error(err);
    el.personaGrid.innerHTML = '<p class="muted">No se pudo cargar. Intenta de nuevo.</p>';
  });
})();
