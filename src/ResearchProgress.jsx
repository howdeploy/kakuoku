import { t } from './i18n.mjs';
import React from 'react';

const actionText = text => t(String(text)).replace(/(?:…|\.{3,})+\s*$/u, '').trim();

export default function ResearchProgress({ progress }) {
  const events = progress?.events || [];
  const action = actionText(events.at(-1)?.text || t("Готовлю ответ"));
  return <div className="message-text research-progress">
    <span className="research-progress-current" role="status" aria-live="polite" aria-atomic="true"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><span>{action}</span></span>
    {events.length > 1 && <details className="research-progress-history"><summary><svg className="research-history-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M7.5 8h9M7.5 12h5M7.5 16h3M15 16h3" /><path className="research-history-plus" d="M16.5 14.5v3" /></svg><span>{t("Ход работы · ")}{events.length}</span></summary><ol aria-live="off">{events.map((event, index) => <li key={index}>{actionText(event.text)}</li>)}</ol></details>}
  </div>;
}
