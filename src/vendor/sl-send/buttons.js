(() => {
  'use strict';
  function mount(root, options = {}) {
    if (!root?.matches('.sl-component')) throw new TypeError('Expected a .sl-component root.');
    const view = root.ownerDocument.defaultView;
    root.dispatchEvent(new view.Event('sl:buttons-remount'));
    const life = new view.AbortController();
    const button = root.querySelector('[data-action]'), label = root.querySelector('[data-label]'), status = root.querySelector('[data-status]');
    let phase = 'idle', request = null, revision = 0, destroyed = false, resetTimer = 0;
    const translate = options.translate || (text => text);
    let announcement = '';
    function announce(text) { announcement = text; status.textContent = translate(text); }
    const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: life.signal });
    const activeElement = () => root.getRootNode().activeElement;
    function render() {
      const labels = ["Отправить","Отправляю…","Отправлено","Повторить"];
      const names = ["Отправить сообщение","Отправляю сообщение","Сообщение отправлено","Повторить отправку"];
      const index = phase === 'pending' ? 1 : phase === 'complete' ? 2 : phase === 'error' ? 3 : 0;
      root.dataset.phase = phase; root.setAttribute('aria-busy', String(phase === 'pending'));
      button.setAttribute('aria-busy', String(phase === 'pending')); button.setAttribute('aria-disabled', String(phase === 'pending'));
      label.textContent = translate(labels[index]); button.setAttribute('aria-label', translate(names[index]));
      status.textContent = translate(announcement);
    }
    function abortWork() { revision++; request?.abort(); request = null; clearTimeout(resetTimer); }
    async function start() {
      if (destroyed || phase === 'pending') return false;
      if (typeof options.onSend !== 'function') { phase = 'error'; render(); announce('Connect onSend before using this button.'); return false; }
      clearTimeout(resetTimer);
      const token = ++revision; request = new view.AbortController(); phase = 'pending'; render(); announce("Sending message.");
      try {
        const result = await options.onSend({ signal: request.signal });
        if (destroyed || token !== revision || request.signal.aborted) return false;
        request = null; phase = 'complete'; render(); announce(options.preview ? "Demo finished locally. No message was sent." : "Message sent.");
        root.dispatchEvent(new view.CustomEvent('sl:action', { bubbles: true, composed: true, detail: { kind: root.dataset.kind, phase, result } }));
        if (destroyed || token !== revision || phase !== 'complete') return true;
        resetTimer = view.setTimeout(() => { if (!destroyed && token === revision && phase === 'complete') { phase = 'idle'; render(); announce("Ready to send."); } }, 1800);
        return true;
      } catch (error) {
        if (destroyed || token !== revision) return false;
        request = null; phase = error?.name === 'AbortError' ? 'idle' : 'error'; render(); announce(phase === 'idle' ? "Ready to send." : "Could not send the message. Try again.");
        return false;
      }
    }
    function cancel() { if (destroyed || phase !== 'pending') return false; abortWork(); phase = 'idle'; render(); announce("Ready to send."); if (activeElement() !== button) button.focus(); return true; }
    function reset() { if (destroyed) return; abortWork(); phase = 'idle'; render(); announce("Ready to send."); }
    function destroy() { if (destroyed) return; reset(); destroyed = true; life.abort(); }
    listen(button, 'click', start); listen(root, 'keydown', event => { if (event.key === 'Escape' && phase === 'pending') { event.preventDefault(); cancel(); } }); listen(root, 'sl:buttons-remount', destroy); reset();
    return { start, cancel, reset, destroy, refreshLocale: render, get state() { return { phase }; } };
  }
  function mountPreview(root) {
    return mount(root, { preview: true, onSend: ({ signal }) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, 620); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Canceled','AbortError')); }, { once: true }); }) });
  }
  window.SLComponent = { mount, mountPreview };
})();
