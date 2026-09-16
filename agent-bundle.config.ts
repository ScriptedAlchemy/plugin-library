import { defineConfig } from 'agent-bundle/config';

export default defineConfig({
  bin: {
    'plugin-library': './bin/plugin-library.mjs',
    'plugin-library-install': './src/install-bin.ts',
  },
  assets: ['public', 'data'],
  lib: false,
  marketplace: true,
  output: { distPath: 'artifact' },
  plugin: {
    description:
      'Browse installed and marketplace plugins, read every skill in full, and hand one to a Grok Bot.',
    name: 'plugin-library',
  },
  runtime: { node: '22.19.0' },
  scripts: {
    'plugin-library': './bin/plugin-library.mjs',
    'plugin-library-server': './server.js',
  },
  targets: ['cursor', 'portable'],
});
