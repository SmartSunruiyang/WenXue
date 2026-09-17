import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

// Render the agent's final result as GFM markdown into the existing design
// system. Every block stays horizontally contained (UIUX §6): code blocks and
// tables scroll inside their own box, long words/URLs wrap — the panel width
// never grows. Raw HTML is not rendered (no rehype-raw) so LLM output is safe.
const components: Components = {
	p: ({ node, className, ...props }) => (
		<p className={cn('mb-2.5 [overflow-wrap:anywhere]', className)} {...props} />
	),
	a: ({ node, className, ...props }) => (
		<a
			{...props}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				'font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground [overflow-wrap:anywhere]',
				className,
			)}
		/>
	),
	h1: ({ node, className, ...props }) => (
		<h1 className={cn('mb-1.5 mt-3 text-base font-semibold first:mt-0', className)} {...props} />
	),
	h2: ({ node, className, ...props }) => (
		<h2 className={cn('mb-1.5 mt-3 text-[15px] font-semibold first:mt-0', className)} {...props} />
	),
	h3: ({ node, className, ...props }) => (
		<h3 className={cn('mb-1 mt-2.5 text-sm font-semibold first:mt-0', className)} {...props} />
	),
	h4: ({ node, className, ...props }) => (
		<h4
			className={cn('mb-1 mt-2.5 text-sm font-semibold text-foreground/90 first:mt-0', className)}
			{...props}
		/>
	),
	h5: ({ node, className, ...props }) => (
		<h5
			className={cn('mb-1 mt-2 text-[13px] font-semibold text-foreground/90 first:mt-0', className)}
			{...props}
		/>
	),
	h6: ({ node, className, ...props }) => (
		<h6
			className={cn(
				'mb-1 mt-2 text-[13px] font-semibold text-muted-foreground first:mt-0',
				className,
			)}
			{...props}
		/>
	),
	ul: ({ node, className, ...props }) => (
		<ul
			className={cn(
				'mb-2.5 list-disc space-y-1 pl-5 marker:text-muted-foreground/60 [overflow-wrap:anywhere]',
				className,
			)}
			{...props}
		/>
	),
	ol: ({ node, className, ...props }) => (
		<ol
			className={cn(
				'mb-2.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground/60 [overflow-wrap:anywhere]',
				className,
			)}
			{...props}
		/>
	),
	li: ({ node, className, ...props }) => (
		<li
			className={cn('[&>input]:mr-1.5 [&>input]:align-middle [&>ol]:mt-1 [&>ul]:mt-1', className)}
			{...props}
		/>
	),
	blockquote: ({ node, className, ...props }) => (
		<blockquote
			className={cn(
				'mb-2.5 border-l-2 border-border pl-3 text-muted-foreground [overflow-wrap:anywhere]',
				className,
			)}
			{...props}
		/>
	),
	code: ({ node, className, ...props }) => (
		<code
			className={cn(
				'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]',
				className,
			)}
			{...props}
		/>
	),
	pre: ({ node, className, ...props }) => (
		<pre
			className={cn(
				'mb-2.5 max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed [&>code]:block [&>code]:whitespace-pre [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[12px] [&>code]:[overflow-wrap:normal]',
				className,
			)}
			{...props}
		/>
	),
	table: ({ node, className, ...props }) => (
		<div className="mb-2.5 max-w-full overflow-x-auto">
			<table className={cn('w-full border-collapse text-[12px]', className)} {...props} />
		</div>
	),
	th: ({ node, className, ...props }) => (
		<th
			className={cn('border border-border px-2 py-1 text-left font-semibold', className)}
			{...props}
		/>
	),
	td: ({ node, className, ...props }) => (
		<td className={cn('border border-border px-2 py-1 align-top', className)} {...props} />
	),
	hr: ({ node, className, ...props }) => (
		<hr className={cn('my-3 border-border', className)} {...props} />
	),
	img: ({ node, className, src, alt, ...props }) =>
		isSafeMarkdownImageSource(src) ? (
			<img alt={alt ?? ''} className={cn('max-w-full rounded', className)} src={src} {...props} />
		) : (
			<span className={cn('text-muted-foreground', className)} role="note">
				{alt ? `[已阻止远程图片：${alt}]` : '[已阻止远程图片]'}
			</span>
		),
	strong: ({ node, className, ...props }) => (
		<strong className={cn('font-semibold', className)} {...props} />
	),
	em: ({ node, className, ...props }) => <em className={cn('italic', className)} {...props} />,
}

export function isSafeMarkdownImageSource(src: string | Blob | undefined): boolean {
	if (typeof src !== 'string' || !src) return false
	if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(src)) return true
	if (src.startsWith('//')) return false
	try {
		const base = new URL(globalThis.location?.href ?? 'https://wenxue.invalid/')
		const resolved = new URL(src, base)
		return resolved.protocol === base.protocol && resolved.origin === base.origin
	} catch {
		return false
	}
}

export function Markdown({ text }: { text: string }) {
	return (
		<div className="min-w-0 max-w-full overflow-x-hidden text-sm leading-relaxed text-foreground [&>*:last-child]:mb-0">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{text}
			</ReactMarkdown>
		</div>
	)
}
