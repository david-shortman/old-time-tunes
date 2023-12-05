const { composePlugins, withNx } = require('@nx/webpack');
const nodeExternals = require('webpack-node-externals');

// Nx plugins for webpack.
module.exports = composePlugins(withNx(), (config) => {
  /*
Changes here copied from https://github.com/nrwl/nx/issues/7872#issuecomment-997460397
*/
  config.externalsPresets = {
    node: true,
  };

  config.output = {
    ...config.output,
    module: true,
    libraryTarget: 'module',
    chunkFormat: 'module',
    filename: '[name].mjs',
    chunkFilename: '[name].mjs',
    library: {
      type: 'module',
    },
    environment: {
      module: true,
    },
  };

  config.experiments = {
    ...config.experiments,
    outputModule: true,
  };

  config.externals = nodeExternals({
    importType: 'module',
  });

  return config;
});
