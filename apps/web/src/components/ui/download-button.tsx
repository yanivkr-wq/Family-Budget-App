'use client';

/**
 * Download button with explicit pending state.
 *
 * Why this exists: native <a download href> links give the user no feedback
 * between click and the browser's download dialog. For server-generated
 * files (Excel exports) that take a few seconds to assemble, the user can
 * easily double-click thinking nothing happened.
 *
 * How it works: instead of relying on the browser to fetch the URL itself,
 * we fetch via JS, capture the blob, then trigger the download
 * programmatically. That gives us a precise "loading" window between the
 * click and the file being ready.
 *
 * Filename handling: if the server sets Content-Disposition with a filename,
 * we honor it (RFC 5987 filename* preferred over plain filename). Otherwise
 * fall back to the `defaultFilename` prop.
 *
 * Trade-off: fetch+blob means the entire file is buffered in memory before
 * the download starts. Fine for our Excel exports (hundreds of KB to a few
 * MB). Don't use this component for very large files.
 */

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  /** URL to fetch the file from. Same origin assumed. */
  href: string;
  /** Visible label / icon content. */
  children: ReactNode;
  /** Fallback filename if the server doesn't set Content-Disposition. */
  defaultFilename?: string;
  /** Tailwind classes — overridable. */
  className?: string;
  /** Loader2 size; matches the surrounding icon visually. */
  loadingSize?: 'sm' | 'md';
  title?: string;
  'aria-label'?: string;
  /** Optional callback fired when download completes successfully. */
  onComplete?: () => void;
  /** Optional callback fired on failure. */
  onError?: (msg: string) => void;
}

export function DownloadButton({
  href,
  children,
  defaultFilename = 'download',
  className,
  loadingSize = 'sm',
  title,
  'aria-label': ariaLabel,
  onComplete,
  onError,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const resp = await fetch(href, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      // Try to extract filename from Content-Disposition. Browsers handle
      // this automatically for native <a download>, but we're doing the
      // download programmatically so we have to parse it ourselves.
      const filename = extractFilename(resp.headers.get('content-disposition')) ?? defaultFilename;

      // Programmatically trigger save via a temporary anchor.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Slight delay before revoking so the browser has time to start the
      // download — Chrome occasionally aborts if the URL goes away too fast.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      onComplete?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה';
      setError(msg);
      onError?.(msg);
    } finally {
      setPending(false);
    }
  }

  const spinnerSize = loadingSize === 'md' ? 'size-4' : 'size-3.5';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title={pending ? 'מוריד…' : title}
        aria-label={ariaLabel}
        aria-busy={pending}
        className={className}
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className={`${spinnerSize} animate-spin`} aria-hidden />
            מוריד…
          </span>
        ) : (
          children
        )}
      </button>
      {error && (
        <span className="ms-2 text-2xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** Parse Content-Disposition for filename. Prefers RFC 5987 filename*=UTF-8''
 *  over the plain ASCII filename="..." since it preserves Hebrew correctly. */
function extractFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  // filename*=UTF-8''<percent-encoded>
  const utf8Match = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(utf8Match[1]); } catch { /* fall through */ }
  }
  // filename="..."
  const plainMatch = /filename="([^"]+)"/i.exec(header);
  if (plainMatch?.[1]) return plainMatch[1];
  // filename=...; (unquoted)
  const bareMatch = /filename=([^;\s]+)/i.exec(header);
  if (bareMatch?.[1]) return bareMatch[1];
  return undefined;
}
