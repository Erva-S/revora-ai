import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { exec } from 'child_process'

// Small plugin that copies the dev server URL to the clipboard on startup
function copyUrlToClipboard() {
  let copied = false
  return {
    name: 'copy-url-to-clipboard',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        if (copied) return
        copied = true
        const address = server.httpServer.address()
        const port = typeof address === 'object' ? address.port : 5173
        const url = `http://localhost:${port}`
        // Windows: pipe to clip.exe
        const proc = exec('clip')
        proc.stdin?.end(url)
        console.log(`\n  🔗 Copied to clipboard: ${url}\n`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), copyUrlToClipboard()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
