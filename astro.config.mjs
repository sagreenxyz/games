import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL || 'https://sagreenxyz.github.io',
  base: process.env.BASE_PATH || '/games',
  output: 'static',
});
