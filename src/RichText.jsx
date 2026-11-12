import { t } from './i18n.mjs';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  a: ({ href, children }) => href
    ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span>{alt || t("Изображение")}</span>,
  table: ({ children }) => <div className="markdown-table" role="region" aria-label={t("Таблица")} tabIndex={0}><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
};

export default function RichText({ text }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}
    urlTransform={url => url.startsWith('#') || /^https?:\/\//i.test(url) ? url : ''}>{text}</Markdown>;
}
