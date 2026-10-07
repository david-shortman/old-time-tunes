export default {
  displayName: 'ott-app',
  preset: '../../jest.preset.cjs',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/next/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // @spotify/basic-pitch ships ESM and CJS builds; Jest runs CommonJS.
  moduleNameMapper: {
    '^@spotify/basic-pitch/esm/(.*)\\.js$': '<rootDir>/../../node_modules/@spotify/basic-pitch/cjs/$1.js',
  },
  coverageDirectory: '../../coverage/apps/ott-app',
};
