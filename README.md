# MathDocs

MathDocs is an offline-first mathematical workpad. It checks each line against the original expression entirely in the browser, saves work locally, and reports one of three honest outcomes:

- **Equivalent** — symbolic rules prove the step preserves the original.
- **Different** — an exact calculation or stable numerical counterexample disproves it.
- **Uncertain** — the engine can prove neither result.

No equation is sent to a server.

## Development

Requires Node.js 22.3 or newer.

```bash
npm install
npm run dev
```

Production and verification commands:

```bash
npm test
npm run build
npm run preview
```

The generated `dist/` directory is a static PWA and can be deployed to Vercel, Cloudflare Pages, GitHub Pages, or any other HTTPS static host.

## Checker behavior

The checker is implemented in `src/checker/checker.ts` with Cortex Compute Engine and runs in a dedicated Web Worker.

It currently supports:

- canonical and simplified expression identities;
- polynomial and common trigonometric identities;
- equations whose residuals are identical or differ by a nonzero constant;
- symbolic derivatives;
- common definite integrals;
- indefinite-integral answers verified by differentiation;
- explicit real-variable assumptions such as `x>0`;
- numerical counterexamples when symbolic simplification is inconclusive.

It intentionally returns **Uncertain** for unsupported solution-set comparisons, domain changes, general inequalities, arbitrary substitution steps, and branch-sensitive identities. Matching random samples never count as proof.

## Local data and offline use

Documents are stored in IndexedDB. On first use, the app imports the old `localStorage.equations` format if it exists. The service worker precaches the UI, fonts, and checker worker after the first successful visit.

CSV import reads the first field of each row. Documents can be exported as CSV or PNG.

The files under `market/` that remain in the repository are historical equation corpora and image assets; the Python/Flask application has been removed.

## Testing

The test suite covers exact identities, incorrect transformations, denominator-domain preservation, equation normalization, derivatives, antiderivatives, and malformed input. Add every checker regression to `src/checker/checker.test.ts` before changing normalization rules.
