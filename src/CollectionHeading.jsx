import { t } from './i18n.mjs';
import React from 'react';

export default function CollectionHeading() {
  return <div className="collection-switcher collection-controls">
    <button className="section-arrow" type="button" data-prev-slide aria-label={t("Предыдущий раздел")}><i className="menu-glyph arrow-left" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m8 11 6 6 6-6" /></svg></i></button>
    <div className="collection-window" tabIndex={0} role="region" aria-roledescription={t("карусель")} aria-label={t("Разделы Kakuoku")}>
      <div className="collection-track collection-title-track">
        <div className="collection-slide" role="group" aria-label={t("1 из 2")}><h1 id="notes-section-title">{t("Мои заметки")}</h1></div>
        <div className="collection-slide" role="group" aria-label={t("2 из 2")} aria-hidden="true" inert><h1 id="gallery-section-title">{t("Галерея")}</h1></div>
      </div>
    </div>
    <button className="section-arrow" type="button" data-next-slide aria-label={t("Следующий раздел")}><i className="menu-glyph arrow-right" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m8 11 6 6 6-6" /></svg></i></button>
    <span className="sr-only" data-slide-status role="status" aria-live="polite" aria-atomic="true">{t("Мои заметки, 1 из 2")}</span>
  </div>;
}
