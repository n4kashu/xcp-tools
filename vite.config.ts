import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3007,
    allowedHosts: ['xcptools.acme.pics'],
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        rewrite: (path) => path.replace(/^\/api/, '/v2'),
        changeOrigin: true,
      },
    },
  },
})
