import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Serve app icon for /favicon.ico to avoid 404 (rewrite to logo svg)
    {
      name: 'favicon-rewrite',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.split('?')[0] === '/favicon.ico') {
            req.url = '/hexabill-logo.svg'
          }
          next()
        })
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  build: {
    // Security: no source maps in production so source code and stack traces are not exposed
    sourcemap: false,
    // Enable minification with safe settings to prevent TDZ errors (st, pt, etc.)
    minify: 'terser',
    terserOptions: {
      compress: {
        // Prevent variable name conflicts that cause TDZ errors
        keep_fnames: true,
        keep_classnames: true,
        // Disable property mangling to prevent 'status' -> 'st' transformation
        properties: false,
        // Prevent inlining of constants
        reduce_vars: false,
        reduce_funcs: false,
      },
      mangle: {
        // Do not mangle these identifiers — Recharts Pie labels use `percent` (often minified to `pt`)
        // and collisions caused "Cannot access 'pt' before initialization" in production.
        reserved: [
          'st', 'status', 'STATUS_PROP', 'TYPE_PROP', 'statusColor', 'entryStatus', 'invoiceStatus', 'safeFilters', 'filterStatusValue', 'filterTypeValue',
          'pt', 'percent', 'props', 'frac', 'sliceName', 'midAngle', 'innerRadius', 'outerRadius'
        ],
        // Disable property mangling completely to prevent 'status' -> 'st'
        properties: false,
      },
      format: {
        // Preserve comments for debugging
        comments: false,
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
