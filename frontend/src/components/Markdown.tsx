import ReactMarkdown from 'react-markdown';

/**
 * Bilgi bankası Markdown'ı. Ham HTML DEVRE DIŞI (`skipHtml`) — makale içeriği personel
 * tarafından yazılsa da public portalda gösterilir; HTML/script enjeksiyonu yolu olmamalı.
 * react-markdown `javascript:` gibi tehlikeli URL'leri zaten ayıklar.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="kb-markdown space-y-3 text-sm leading-relaxed [&_a]:text-primary-600 [&_a]:underline [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 dark:[&_code]:bg-slate-800 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-inset [&_pre]:bg-gray-100 [&_pre]:p-3 dark:[&_pre]:bg-slate-800 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:text-muted">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ href, children: text }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{text}</a>,
          img: ({ alt }) => <span className="text-muted">[{alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
