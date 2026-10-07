// Metro config: the app shares FORM's pure-TypeScript domain rules (packages/domain) so on-device
// analysis (camera framing, pose) uses exactly the same code as the API.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const domain = path.resolve(__dirname, '../../packages/domain');

config.watchFolders = [...(config.watchFolders ?? []), domain];
// Shared files outside this app resolve their dependencies (e.g. Babel helpers) from the app's node_modules.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.join(__dirname, 'node_modules')];
config.resolver.extraNodeModules = { ...(config.resolver.extraNodeModules ?? {}), '@form/domain': path.join(domain, 'src') };

module.exports = config;
