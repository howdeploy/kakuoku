import { t } from './i18n.mjs';
import React from 'react';
import './vendor/sl-loading/buttons.css';

export default function PreviewStatus({ label = t("Обновляю превью…") }) {
  label = t(label);
  return <span className="preview-status" role="status" aria-live="polite" aria-atomic="true" data-source="sl-ui:matte-loading-feedback:quiet-pulse-adaptation">
    <span className="sr-only">{label}</span>
    <span className="preview-status-wave" aria-hidden="true">{Array.from(label).map((letter, index) => <span key={index} className="preview-status-letter" style={{ animationDelay: `${index * 60}ms` }}>{letter === ' ' ? '\u00a0' : letter}</span>)}</span>
  </span>;
}
