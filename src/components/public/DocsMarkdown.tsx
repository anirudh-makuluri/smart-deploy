import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { resolveDocHref } from "@/lib/resolve-doc-href";

const components: Components = {
	h1: ({ children }) => (
		<h1 className="mt-10 scroll-mt-20 border-b border-border pb-2 text-2xl font-semibold tracking-tight text-foreground first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="mt-9 scroll-mt-20 text-xl font-semibold tracking-tight text-foreground">{children}</h2>
	),
	h3: ({ children }) => (
		<h3 className="mt-7 text-lg font-semibold tracking-tight text-foreground">{children}</h3>
	),
	h4: ({ children }) => <h4 className="mt-6 text-base font-semibold text-foreground">{children}</h4>,
	p: ({ children }) => <p className="mt-3 text-sm leading-7 text-muted-foreground">{children}</p>,
	ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-7 text-muted-foreground">{children}</ul>,
	ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-7 text-muted-foreground">{children}</ol>,
	li: ({ children }) => <li className="marker:text-foreground/70">{children}</li>,
	blockquote: ({ children }) => (
		<blockquote className="mt-4 border-l-2 border-border pl-4 text-sm italic text-muted-foreground">{children}</blockquote>
	),
	hr: () => <hr className="my-8 border-border" />,
	a: ({ href, children }) => {
		const resolved = href ? resolveDocHref(href) : href;
		if (resolved?.startsWith("/")) {
			return (
				<Link href={resolved} className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
					{children}
				</Link>
			);
		}
		return (
			<a
				href={resolved}
				className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
				rel={resolved?.startsWith("http") ? "noreferrer" : undefined}
				target={resolved?.startsWith("http") ? "_blank" : undefined}
			>
				{children}
			</a>
		);
	},
	pre: ({ children }) => (
		<pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/50 p-4 text-xs leading-relaxed">{children}</pre>
	),
	code: ({ className, children, ...props }) => {
		const isBlock = Boolean(className);
		if (isBlock) {
			return (
				<code className={`font-mono text-xs text-foreground ${className ?? ""}`} {...props}>
					{children}
				</code>
			);
		}
		return (
			<code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.9em] text-foreground" {...props}>
				{children}
			</code>
		);
	},
	table: ({ children }) => (
		<div className="my-4 overflow-x-auto">
			<table className="w-full min-w-[20rem] border-collapse border border-border text-left text-sm">{children}</table>
		</div>
	),
	thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
	th: ({ children }) => (
		<th className="border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground">{children}</th>
	),
	td: ({ children }) => <td className="border border-border px-3 py-2 text-muted-foreground">{children}</td>,
	tr: ({ children }) => <tr>{children}</tr>,
};

export function DocsMarkdown({ source }: { source: string }) {
	return (
		<article className="max-w-none">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{source}
			</ReactMarkdown>
		</article>
	);
}
