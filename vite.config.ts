import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  plugins: [
    ...(mode === 'test' ? [] : [devtools(), nitro()]),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}))

export default config
