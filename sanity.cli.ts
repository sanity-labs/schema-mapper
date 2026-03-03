import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  app: {
    organizationId: 'YOUR_ORG_ID', // TODO: Replace with your Sanity organization ID
    entry: './src/App.tsx',
  },
  // deployment: {
  //   appId: 'YOUR_APP_ID', // Uncomment after first deploy
  // },
  vite: async (viteConfig) => {
    const path = await import('path')
    const {default: tailwindcss} = await import('@tailwindcss/vite')
    return {
      ...viteConfig,
      plugins: [
        ...(viteConfig.plugins || []),
        tailwindcss()
      ],
      resolve: {
        ...viteConfig.resolve,
        alias: {
          ...((viteConfig.resolve?.alias as Record<string, string>) || {}),
          '@': path.resolve(process.cwd(), './src'),
        },
      },
      server: {
        ...viteConfig.server,
        headers: {
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Allow-Origin': '*',
        },
      },
    }
  }
})
