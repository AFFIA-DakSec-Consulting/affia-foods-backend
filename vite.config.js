import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// In dev (and `vite preview`) "/contact" must open contact/index.html, like cleanUrls does on Vercel.
const PAGES = ['contact', 'partenaire', 'livreur', 'privacy', 'terms', 'refunds'];
const cleanUrls = () => {
  const rewrite = (req, _res, next) => {
    const [path, query = ''] = (req.url || '').split('?');
    const clean = path.replace(/\/$/, '');
    if (PAGES.includes(clean.slice(1))) req.url = `${clean}/index.html${query ? `?${query}` : ''}`;
    next();
  };
  return {
    name: 'clean-urls',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
};

export default defineConfig({
  plugins: [cleanUrls()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy/index.html'),
        terms: resolve(__dirname, 'terms/index.html'),
        refunds: resolve(__dirname, 'refunds/index.html'),
        contact: resolve(__dirname, 'contact/index.html'),
        partenaire: resolve(__dirname, 'partenaire/index.html'),
        livreur: resolve(__dirname, 'livreur/index.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
});
