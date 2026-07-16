import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  // ▼▼▼ CUSTOMER APP CONFIG — preserved on update ▼▼▼
  // Values inside this marker block are preserved when Schema Mapper updates.
  // You can comment-out alternatives to swap between test orgs:
  //   // organizationId: 'oyQ25CIX0', // michael
  //   organizationId: 'oSyH1iET5',    // 360
  // See docs/configuration.md for details.
  app: {
    organizationId: 'YOUR_ORG_ID', // TODO: Replace with your Sanity organization ID
    entry: './src/App.tsx',
    icon: './static/icon.svg',
  },
  // deployment: {
  //   appId: 'YOUR_APP_ID', // Uncomment after first deploy
  // },
  // ▲▲▲ END CUSTOMER APP CONFIG ▲▲▲
  vite: async (viteConfig) => {
    const path = await import('node:path')
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
          ...(viteConfig.resolve?.alias ?? {}),
          '@': path.resolve(process.cwd(), './src'),
        },
      },
      server: {
        ...viteConfig.server,
        hmr: {
          ...((viteConfig.server as any)?.hmr || {}),
          overlay: false,
        },
        headers: {
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Allow-Origin': '*',
        },
      },
    }
  }
})
