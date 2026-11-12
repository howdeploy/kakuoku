import { t, useLanguage } from './i18n.mjs';
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import './vendor/sl-send/buttons.js';
import './vendor/sl-send/buttons.css';

export default forwardRef(function SendButton({ onSend, disabled }, ref) {
  const language = useLanguage();
  const root = useRef(null);
  const controller = useRef(null);
  const latest = useRef({ onSend, disabled });
  function syncDisabled() {
    const button = root.current?.querySelector('[data-action]');
    // Pending uses the source's aria-disabled state so Escape can still cancel.
    if (button) button.disabled = latest.current.disabled && controller.current?.state.phase !== 'pending';
  }
  useLayoutEffect(() => { latest.current = { onSend, disabled }; syncDisabled(); });
  useLayoutEffect(() => { controller.current?.refreshLocale(); }, [language]);
  useImperativeHandle(ref, () => ({
    start: () => latest.current.disabled ? Promise.resolve(false) : controller.current?.start(),
  }), []);
  useEffect(() => {
    const playing = new Set();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = () => { if (motion.matches) playing.forEach(animation => animation.cancel()); };
    motion.addEventListener('change', reduceMotion);
    const mounted = window.SLComponent.mount(root.current, { translate: t, onSend: async options => {
      const animations = [];
      const pen = root.current.querySelector('.note-pen');
      if (!motion.matches && pen.animate) {
        animations.push(pen.animate([
          { transform: 'translate(-4px, -5px)', offset: 0 },
          { transform: 'translate(1px, -5px)', offset: .25 },
          { transform: 'translate(-4px, -2px)', offset: .34 },
          { transform: 'translate(3px, -2px)', offset: .6 },
          { transform: 'translate(-4px, 1px)', offset: .7 },
          { transform: 'translate(1px, 1px)', offset: .94 },
          { transform: 'translate(0, 0)', offset: 1 },
        ], { duration: 440, easing: 'ease-in-out', fill: 'both' }));
        root.current.querySelectorAll('.note-stroke').forEach((line, index) => {
          animations.push(line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
            duration: 120, delay: index * 145, easing: 'ease-out', fill: 'both',
          }));
        });
      }
      const cancel = () => animations.forEach(animation => { animation.cancel(); playing.delete(animation); });
      animations.forEach(animation => playing.add(animation));
      const writing = Promise.all(animations.map(animation => animation.finished.catch(() => {})));
      options.signal.addEventListener('abort', cancel, { once: true });
      try {
        const result = await latest.current.onSend(options);
        await writing;
        return result;
      } finally {
        options.signal.removeEventListener('abort', cancel);
        cancel();
      }
    } });
    controller.current = mounted;
    const observer = new MutationObserver(syncDisabled);
    observer.observe(root.current, { attributes: true, attributeFilter: ['data-phase'] });
    syncDisabled();
    return () => { observer.disconnect(); mounted.destroy(); motion.removeEventListener('change', reduceMotion); playing.forEach(animation => animation.cancel()); playing.clear(); controller.current = null; };
  }, []);
  return <section ref={root} className="sl-component send-control" data-kind="buttons-send-message" data-phase="idle" aria-busy="false" aria-label={t("Отправить сообщение")} data-source="sl-ui:matte-buttons-send-message-v11">
    <button className="motion-button" type="button" data-action aria-label={t("Отправить сообщение")}>
      <span className="button-surface" aria-hidden="true"><span className="button-icon"><svg viewBox="0 0 24 24" focusable="false">
        <g className="icon-primary note-writing">
          <rect x="4" y="3" width="13" height="18" rx="2" fill="var(--paper)" strokeWidth="1.5" />
          <path className="note-stroke" pathLength="1" d="M7 9h5" strokeWidth="1.4" />
          <path className="note-stroke" pathLength="1" d="M7 12h7" strokeWidth="1.4" />
          <path className="note-stroke" pathLength="1" d="M7 15h5" strokeWidth="1.4" />
          <g className="note-pen">
            <path d="m11 14 1-3 7-7a1.4 1.4 0 0 1 2 2l-7 7-3 1Z" fill="var(--paper)" strokeWidth="1.5" />
            <path d="m17.5 5.5 2 2M12 11l2 2" strokeWidth="1.2" />
          </g>
        </g>
        <path className="icon-result" pathLength="1" d="m5 12 4.5 4.5L19 7" />
      </svg></span><span className="button-label sr-only" data-label>{t("Отправить")}</span></span>
    </button>
    <p className="component-status sr-only" data-status role="status" aria-live="polite" aria-atomic="true" />
  </section>;
});
