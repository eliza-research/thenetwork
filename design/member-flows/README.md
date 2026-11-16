# Member flow design studio

Run `pnpm run design:members`, then open http://127.0.0.1:5190.

Choose an app, page and screen. Click a text element, edit its copy, and select **Save to source**.
Use **Layout** to change content width, corner radius and heading size for the secondary pages.
Use **Mobile view** to inspect a 390 px screen. Homepages stay unchanged.

The studio reads the actual site HTML and shared OAuth renderers. Screens contain fictional data.
It never calls a member API or sends a text. A successful preview is not an authentication test.
The loopback server checks the Host and Origin before writes. It accepts only listed files.
A stale source revision cannot overwrite a newer edit. Git retains the original text for review.

Copy saves update `sites/<domain>/public/<page>.html`. OAuth static copy saves update
`packages/mcp/src/pages.ts`; these changes apply to every app. Interpolated text,
HTML with nested elements, and runtime messages need a source edit. Layout saves update
`sites/shared/member.css`. Review the diff before publishing. Consent wording must match the backend.

For real local requests, run `pnpm run platform:dev` against a dedicated local database.
The four sites run on ports 5101–5104. Codes print in that terminal; nothing is texted.
Use fictional 555-01xx numbers only. The studio and local runtime do not deploy changes.

Phone verification returns directly to the assistant. There is no permission screen.
Connected assistants remain available to remove access. Removed support, safety and guidelines pages return 404.
