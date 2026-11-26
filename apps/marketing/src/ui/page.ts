import { escHtml, NETWORK_FAVICON_DATA_URI } from "./icons.ts";
import { renderCommandCenterCss } from "./styles.ts";
import { renderCommandCenterJs } from "./client.ts";

export interface CommandCenterHtmlOptions {
  nonce?: string;
  inlineAssets?: boolean;
  title?: string;
}

export function commandCenterSecurityHeaders(opts?: { nonce?: string }): Record<string, string> {
  const noncePart = opts?.nonce ? ` 'nonce-${opts.nonce}'` : "";
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self'${noncePart}`,
      `style-src 'self'${noncePart}`,
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

export function renderCommandCenterHtml(opts?: CommandCenterHtmlOptions): string {
  const title = opts?.title ?? "The Network — Marketing";
  const inline = Boolean(opts?.inlineAssets);
  const nonceAttr = opts?.nonce ? ` nonce="${escHtml(opts.nonce)}"` : "";

  const styleTag = inline
    ? `<style${nonceAttr}>${renderCommandCenterCss()}</style>`
    : `<link rel="stylesheet" href="/assets/app.css" />`;

  const scriptTag = inline
    ? `<script${nonceAttr}>${renderCommandCenterJs()}</script>`
    : `<script src="/assets/app.js" defer></script>`;

  return `<!doctype html>
<html lang="en" data-brand="network">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${escHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="${NETWORK_FAVICON_DATA_URI}" />
  ${styleTag}
</head>
<body>
  <div id="app" role="application" aria-label="Marketing Command Center"></div>
  <noscript><p>JavaScript is required to open the Marketing Command Center.</p></noscript>
  ${scriptTag}
</body>
</html>`;
}
