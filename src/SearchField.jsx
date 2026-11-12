import { t } from './i18n.mjs';
import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import './vendor/sl-search/buttons.js';
import './vendor/sl-search/buttons.css';

export default forwardRef(function SearchField({ value, onChange, label = t("Поиск по всем заметкам и переписке") }, ref) {
  const root = useRef(null);
  const input = useRef(null);
  const id = useId();
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  useEffect(() => {
    // FTS results live in the collection; the library's local demo suggestions stay off.
    const controller = window.MatteSearchInput.mount(root.current, { items: [], suggestions: false });
    return () => controller.destroy();
  }, []);
  useLayoutEffect(() => {
    root.current.querySelector('.sl-field__clear').hidden = !value;
  }, [value]);
  return <div ref={root} className="search-field sl-field sl-field--search" data-search-open="false" data-has-value={Boolean(value)} data-source="sl-ui:matte-search-input">
    <div className="sl-field__control">
      <svg className="sl-field__leading" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input ref={input} id={id} className="sl-field__input" type="search" placeholder=" " autoComplete="off" spellCheck={false} maxLength={300} value={value} onInput={event => onChange(event.currentTarget.value)} onChange={() => {}} aria-label={label} />
      <label className="sl-field__label" htmlFor={id}>{t("Поиск")}</label>
      <button className="sl-field__action sl-field__clear" type="button" aria-label={t("Очистить поиск")} aria-controls={id} disabled={!value} hidden={!value}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>
      <kbd aria-hidden="true">Ctrl K</kbd>
    </div>
    <div className="sl-field__popup" hidden inert><ul className="sl-field__options" id={`${id}-options`} /><p className="sl-field__empty" hidden /></div>
    <p className="sl-field__helper" hidden />
  </div>;
});
