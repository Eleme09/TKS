(function () {
  'use strict';

  // Toasts y modal de confirmación compartidos entre catalog.js y admin.js,
  // para no depender de alert()/confirm() nativos (rompen la identidad
  // visual y se ven mal en móvil). Sin librería: un par de nodos inyectados
  // una sola vez y reutilizados.

  function ensureToastStack() {
    let stack = document.getElementById('vwToastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'vwToastStack';
      stack.className = 'vw-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type) {
    const stack = ensureToastStack();
    const node = document.createElement('div');
    node.className = `vw-toast vw-toast--${type || 'ok'}`;
    node.textContent = message;
    stack.appendChild(node);
    requestAnimationFrame(() => node.classList.add('vw-toast--show'));
    setTimeout(() => {
      node.classList.remove('vw-toast--show');
      setTimeout(() => node.remove(), 220);
    }, 3200);
  }

  function confirmDialog(message, { confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = true } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'vw-modal-overlay';
      overlay.innerHTML = `
        <div class="vw-modal-box" role="alertdialog" aria-modal="true" aria-label="Confirmación">
          <p>${String(message).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>
          <div class="vw-modal-actions">
            <button type="button" class="btn vw-modal-cancel">${cancelLabel}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-accent'} vw-modal-confirm">${confirmLabel}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const confirmBtn = overlay.querySelector('.vw-modal-confirm');
      const cancelBtn = overlay.querySelector('.vw-modal-cancel');

      function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onKeydown(e) {
        if (e.key === 'Escape') close(false);
      }
      confirmBtn.addEventListener('click', () => close(true));
      cancelBtn.addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKeydown);
      confirmBtn.focus();
    });
  }

  function skeletonGrid(count) {
    return Array.from({ length: count })
      .map(() => '<div class="card card-skeleton"><div class="card-photo skeleton-block"></div><div class="card-body"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:85%"></div><div class="skeleton-line" style="width:40%"></div></div></div>')
      .join('');
  }

  window.VW_UI = { toast, confirmDialog, skeletonGrid };

  // En celular las tablas se apilan como tarjetas; cada celda lleva su
  // encabezado como etiqueta (data-label) para saber qué es cada dato.
  function labelTable(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        if (heads[i] && !td.dataset.label) td.dataset.label = heads[i];
      });
    });
  }

  function labelAll() {
    document.querySelectorAll('.table-wrap table').forEach(labelTable);
  }

  let labelTimer = null;
  new MutationObserver(() => {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(labelAll, 30);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Con una ventana emergente abierta, la página de atrás no se desplaza:
  // se congela el body (iOS Safari ignora overflow:hidden a secas).
  let lockY = 0;
  let locked = false;
  function syncScrollLock() {
    const open = !!document.querySelector('.vw-modal-overlay:not([hidden])');
    if (open && !locked) {
      locked = true;
      lockY = window.scrollY;
      document.body.style.top = `-${lockY}px`;
      document.body.classList.add('modal-lock');
    } else if (!open && locked) {
      locked = false;
      document.body.classList.remove('modal-lock');
      document.body.style.top = '';
      window.scrollTo(0, lockY);
    }
  }
  new MutationObserver(syncScrollLock).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
})();
