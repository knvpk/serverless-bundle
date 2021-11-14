const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const webpack = require("webpack");
const fastGlob = require("fast-glob");
const slsw = require("serverless-webpack");
const importFresh = require("import-fresh");
const ESLintPlugin = require("eslint-webpack-plugin");
const nodeExternals = require("webpack-node-externals");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { ESBuildMinifyPlugin } = require("esbuild-loader");
const ConcatTextPlugin = require("concat-text-webpack-plugin");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");
const PermissionsOutputPlugin = require("webpack-permissions-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const config = require("./config");

const jsEslintConfig = require("./eslintrc.json");
const tsEslintConfig = require("./ts.eslintrc.json");
const {WebpackRequireInTheMiddlePlugin} = require("./require_in_the_middle");
const { RuntimeGlobals } = require("webpack");

// Load the default config for reference
// Note:  This import potentially clears our the dynamically loaded config. So any other
//        imports of the config after this, load the default config as well. Make sure to
//        use this after importing the config.
const defaultConfig = importFresh("./config");

// const isLocal = slsw.lib.webpack.isLocal;
const isLocal = true;

const aliases = config.options.aliases;
const servicePath = config.servicePath;
const nodeVersion = config.nodeVersion;
const externals = config.options.externals;
const copyFiles = config.options.copyFiles;
const concatText = config.options.concatText;
const esbuildNodeVersion = "node" + nodeVersion;
const forceExclude = config.options.forceExclude;
const ignorePackages = config.options.ignorePackages;
const rawFileExtensions = config.options.rawFileExtensions;
const fixPackages = convertListToObject(config.options.fixPackages);
const tsConfigPath = path.resolve(servicePath, config.options.tsConfig);

const ENABLE_ESBUILD = config.options.esbuild;
const ENABLE_STATS = config.options.stats;
const ENABLE_LINTING = config.options.linting;
const ENABLE_SOURCE_MAPS = config.options.sourcemaps;
const ENABLE_TYPESCRIPT = fs.existsSync(tsConfigPath);
const ENABLE_TSCHECKER = !config.options.disableForkTsChecker;
const ENABLE_CACHING = isLocal ? config.options.caching : false;

// Handle the "all" option in externals
// And add the forceExclude packages to it because they shouldn't be Webpacked
const computedExternals = (
  externals === "all" ? [nodeExternals()] : externals
).concat(forceExclude);

const extensions = [
  ".wasm",
  ".mjs",
  ".js",
  ".jsx",
  ".json",
  ".ts",
  ".tsx",
  ".graphql",
  ".gql",
];

// If tsConfig is specified and not found, throw an error
if (
  !ENABLE_TYPESCRIPT &&
  config.options.tsConfig !== defaultConfig.options.tsConfig
) {
  throw `ERROR: ${config.options.tsConfig} not found.`;
}

if (ENABLE_TYPESCRIPT && checkInvalidTsModule()) {
  console.log("serverless-bundle: CommonJS, ES3, or ES5 are not supported");
}

function checkInvalidTsModule() {
  // Borrowed from
  // https://github.com/formium/tsdx/blob/e84e8d654c8462b8db65a3d395e2a4ba79bf1bd2/src/createRollupConfig.ts#L49-L55
  const tsConfigJSON = ts.readConfigFile(tsConfigPath, ts.sys.readFile).config;
  const tsCompilerOptions = ts.parseJsonConfigFileContent(
    tsConfigJSON,
    ts.sys,
    "./"
  ).options;

  const module = tsCompilerOptions.module;
  const target = tsCompilerOptions.target;

  return (
    (module !== undefined && module === 1) || // commonjs
    (target !== undefined && (target === 0 || target === 1)) // es3 or es5
  );
}

function convertListToObject(list) {
  var object = {};

  for (var i = 0, l = list.length; i < l; i++) {
    object[list[i]] = true;
  }

  return object;
}

function resolveEntriesPath(entries) {
  for (let key in entries) {
    entries[key] = path.join(servicePath, entries[key]);
  }

  return entries;
}

function statModeToOctal(mode) {
  return (mode & parseInt("777", 8)).toString(8);
}

function babelLoader() {
  const plugins = [
    "@babel/plugin-transform-runtime",
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-proposal-optional-chaining",
    "@babel/plugin-proposal-nullish-coalescing-operator",
  ];

  if (ENABLE_SOURCE_MAPS) {
    plugins.push("babel-plugin-source-map-support");
  }

  return {
    loader: "babel-loader",
    options: {
      // Enable caching
      cacheDirectory: ENABLE_CACHING,
      // Disable compresisng cache files to speed up caching
      cacheCompression: false,
      plugins: plugins.map(require.resolve),
      sourceType: "unambiguous",
      presets: [
        [
          require.resolve("@babel/preset-env"),
          {
            targets: {
              node: nodeVersion,
            },
          },
        ],
      ],
    },
  };
}

function esbuildLoader(loader) {
  const options = {
    loader,
    target: esbuildNodeVersion,
  };

  if (ENABLE_TYPESCRIPT) {
    options.tsconfigRaw = fs.readFileSync(tsConfigPath);
  }

  return {
    loader: "esbuild-loader",
    options,
  };
}

function tsLoader() {
  return {
    loader: "ts-loader",
    options: {
      projectReferences: true,
      configFile: tsConfigPath,
      experimentalWatchApi: true,
      // Don't check types if ForTsChecker is enabled
      transpileOnly: ENABLE_TSCHECKER,
    },
  };
}

function loaders() {
  const jsRule = {
    test: /\.js$/,
    exclude: /node_modules/,
    use: [ENABLE_ESBUILD ? esbuildLoader("jsx") : babelLoader()],
  };

  const loaders = {
    rules: [
      jsRule,
      {
        test: /\.mjs$/,
        include: /node_modules/,
        type: "javascript/auto",
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.(graphql|gql)$/,
        exclude: /node_modules/,
        loader: "graphql-tag/loader",
      },
      {
        test: /\.css$/,
        use: [
          "isomorphic-style-loader",
          {
            loader: "css-loader",
            options: {
              importLoaders: 1,
            },
          },
        ],
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          "isomorphic-style-loader",
          {
            loader: "css-loader",
            options: {
              importLoaders: 1,
            },
          },
          {
            loader: "sass-loader",
            options: {
              implementation: require("sass"),
            },
          },
        ],
      },
      { test: /\.gif|\.svg|\.png|\.jpg|\.jpeg$/, loader: "ignore-loader" },
    ],
  };

  if (ENABLE_TYPESCRIPT) {
    const tsRule = {
      test: /\.(ts|tsx)$/,
      use: [ENABLE_ESBUILD ? esbuildLoader("tsx") : tsLoader()],
      exclude: [
        [
          path.resolve(servicePath, "node_modules"),
          path.resolve(servicePath, ".serverless"),
          path.resolve(servicePath, ".webpack"),
        ],
      ],
    };

    loaders.rules.push(tsRule);
  }

  if (rawFileExtensions && rawFileExtensions.length) {
    const rawFileRegex = `${rawFileExtensions
      .map((rawFileExt) => `\\.${rawFileExt}`)
      .join("|")}$`;

    loaders.rules.push({
      test: new RegExp(rawFileRegex),
      loader: "raw-loader",
    });
  }

  return loaders;
}

function plugins() {
  const plugins = [];

  // const modules = [
  //   'apollo-server-core',
  //   'bluebird',
  //   'cassandra-driver',
  //   'elasticsearch',
  //   'express',
  //   'express-graphql',
  //   'express-queue',
  //   'fastify',
  //   'finalhandler',
  //   'generic-pool',
  //   'graphql',
  //   'handlebars',
  //   'hapi',
  //   '@hapi/hapi',
  //   'http',
  //   'https',
  //   'http2',
  //   'ioredis',
  //   'jade',
  //   'knex',
  //   'koa',
  //   'koa-router',
  //   '@koa/router',
  //   'memcached',
  //   'mimic-response',
  //   'mongodb-core',
  //   'mongodb',
  //   'mysql',
  //   'mysql2',
  //   'pg',
  //   'pug',
  //   'redis',
  //   'restify',
  //   'tedious',
  //   'ws'
  // ]

  // plugins.push(new WebpackRequireInTheMiddlePlugin(modules))

  // plugins.push(
  //   {
  //     apply(compiler) {
  //       console.log(Object.keys(compiler.hooks))
  //       compiler.hooks.compilation.tap("RequireInTheMiddle", (compilation) => {
  //         const modulesMap = new Map();
  //         console.log(compilation.hooks.runtimeGlobals);

  //         /**
  //          * Prepare modulesMap.
  //          * Store filename and mainModuleFilename
  //          * because require-in-the-middle can't resolve main module's filepath in runtime.
  //          */
  //         compilation.hooks.afterOptimizeModuleIds.tap(
  //           "RequireInTheMiddle",
  //           (modules) => {
  //             modules.forEach((m) => {
  //               let filename = m.resource || m.request;
  //               let mainModuleFilename = null;

  //               // this part is similar to require-in-the-middle
  //               const core = isCore(filename);
  //               if (!core && filename) {
  //                 const stat = parse(filename);
  //                 if (stat) {
  //                   const moduleName = stat.name;
  //                   const basedir = stat.basedir;
  //                   mainModuleFilename = resolve.sync(moduleName, {
  //                     basedir,
  //                   });

  //                   filename = path.relative(projectRoot, filename);
  //                   mainModuleFilename = path.relative(
  //                     projectRoot,
  //                     mainModuleFilename
  //                   );
  //                 }
  //               }

  //               modulesMap.set(m.id, { filename, mainModuleFilename });
  //             });
  //             return modules;
  //           }
  //         );


  //         /**
  //          * Update Webpack runtime code.
  //          * 1. Make __webpack_require__ to call implementation from variable.
  //          * 2. Set modulesMap to let require-in-the-middle find package name by id.
  //          */
  //         console.log(Object.keys(RuntimeGlobals.startupOnlyBefore));
          
  //       //   compilation.mainTemplate.hooks.beforeStartup.tap(
  //       //     "RequireInTheMiddle",
  //       //     (source, chunk, hash) => {
  //       //       const buf = [];

  //       //       // move to implementation
  //       //       buf.push(`const __webpack_require_impl__ = __webpack_require__;`);
  //       //       buf.push(`__webpack_require__ = function (moduleId) {`);
  //       //       buf.push(`    return __webpack_require__.impl(moduleId);`);
  //       //       buf.push(`}`);
  //       //       buf.push(
  //       //         `Object.assign(__webpack_require__, __webpack_require_impl__);`
  //       //       );
  //       //       buf.push(`__webpack_require__.impl = __webpack_require_impl__;`);

  //       //       // set modulesMap
  //       //       buf.push(
  //       //         `__webpack_require__.modulesMap = new Map(${JSON.stringify(
  //       //           Array.from(modulesMap.entries()),
  //       //           null,
  //       //           2
  //       //         )});`
  //       //       );
  //       //       return buf;
  //       //     }
  //       //   );

  //       //   /* update source of require-in-the-middle */
  //       //   compilation.hooks.succeedModule.tap("RequireInTheMiddle", (m) => {
  //       //     if (
  //       //       m.resource &&
  //       //       m.resource.includes("require-in-the-middle/index.js")
  //       //     ) {
  //       //       // replace Module.prototype.require with __webpack_require__.impl
  //       //       m._source._value = m._source._value.replace(
  //       //         /Module\.prototype\.require/g,
  //       //         "__webpack_require__.impl"
  //       //       );

  //       //       // restore filename, mainModuleFilename from modulesMap
  //       //       m._source._value = m._source._value.replace(
  //       //         `if (self._unhooked === true) {`,
  //       //         `const { filename, mainModuleFilename } = __webpack_require__.modulesMap.get(id);
  //       //         if (self._unhooked === true) {`
  //       //       );

  //       //       /**
  //       //        * Remove Module._resolveFilename, because we already have filename
  //       //        * and it is impossible to resolve it in runtime (no node_modules)
  //       //        */
  //       //       m._source._value = m._source._value.replace(
  //       //         `const filename = Module._resolveFilename(id, this)`,
  //       //         ``
  //       //       );

  //       //       /**
  //       //        * Remove resolve.sync, because we already have mainModuleFilename
  //       //        * and it is impossible to resolve it in runtime (no node_modules)
  //       //        *
  //       //        * TODO: We are losing try-catch here, but it should appear in prepare modulesMap section
  //       //        */
  //       //       m._source._value = m._source._value.replace(
  //       //         `        let res
  //       // try {
  //       //   res = resolve.sync(moduleName, { basedir })
  //       // } catch (e) {
  //       //   debug('could not resolve module: %s', moduleName)
  //       //   return exports // abort if module could not be resolved (e.g. no main in package.json and no index.js file)
  //       // }`,
  //       //         ``
  //       //       );

  //       //       // replace res with mainModuleFilename (see previous step)
  //       //       m._source._value = m._source._value.replace(
  //       //         `if (res !== filename)`,
  //       //         `if (mainModuleFilename !== filename)`
  //       //       );
  //       //       m._source._value = m._source._value.replace(
  //       //         `debug('ignoring require of non-main module file: %s', res)`,
  //       //         `debug('ignoring require of non-main module file: %s', mainModuleFilename)`
  //       //       );
  //       //     }
  //       //   });
  //       });
  //     },
  //   },
  // )


  if (ENABLE_TYPESCRIPT && ENABLE_TSCHECKER) {
    const forkTsCheckerWebpackOptions = {
      typescript: {
        configFile: tsConfigPath,
        build: true,
      },
    };

    if (ENABLE_LINTING) {
      forkTsCheckerWebpackOptions.eslint = {
        files: path.join(servicePath, "**/*.ts"),
        options: { cwd: servicePath, baseConfig: tsEslintConfig },
      };
    }

    plugins.push(new ForkTsCheckerWebpackPlugin(forkTsCheckerWebpackOptions));
  }

  if (ENABLE_LINTING) {
    plugins.push(
      new ESLintPlugin({
        context: servicePath,
        baseConfig: jsEslintConfig,
        extensions: "js",
      })
    );

    // If the ForkTsChecker is disabled, then let Eslint do the linting
    if (ENABLE_TYPESCRIPT && !ENABLE_TSCHECKER) {
      plugins.push(
        new ESLintPlugin({
          context: servicePath,
          baseConfig: tsEslintConfig,
          extensions: ["ts"],
        })
      );
    }
  }

  if (copyFiles) {
    plugins.push(
      new CopyWebpackPlugin({
        patterns: copyFiles.map(function (data) {
          return {
            to: data.to,
            context: servicePath,
            from: path.join(servicePath, data.from),
          };
        }),
      })
    );

    // Copy file permissions
    const buildFiles = [];
    copyFiles.forEach(function (data) {
      const entries = fastGlob.sync([data.from]);
      // loop through each file matched by fg
      entries.forEach(function (entry) {
        // get source file stat
        const stat = fs.statSync(path.resolve(servicePath, entry));
        const { serverless } = slsw.lib;
        if (
          serverless.service.package.individually &&
          serverless.service.functions
        ) {
          for (let key in serverless.service.functions) {
            buildFiles.push({
              fileMode: statModeToOctal(stat.mode),
              path: path.resolve(data.to, `.webpack/${key}`, entry),
            });
          }
        } else {
          buildFiles.push({
            fileMode: statModeToOctal(stat.mode),
            path: path.resolve(data.to, ".webpack/service", entry),
          });
        }
      });
    });
    plugins.push(new PermissionsOutputPlugin({ buildFiles }));
  }

  if (concatText) {
    const concatTextConfig = {};

    concatText.map(function (data) {
      concatTextConfig.files = data.files || null;
      concatTextConfig.name = data.name || null;
      concatTextConfig.outputPath = data.outputPath || null;
    });

    plugins.push(new ConcatTextPlugin(concatTextConfig));
  }

  // Ignore all locale files of moment.js
  plugins.push(
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    })
  );

  // Ignore any packages specified in the `ignorePackages` option
  for (let i = 0, l = ignorePackages.length; i < l; i++) {
    plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: new RegExp("^" + ignorePackages[i] + "$"),
      })
    );
  }

  if (fixPackages["formidable@1.x"]) {
    plugins.push(new webpack.DefinePlugin({ "global.GENTLY": false }));
  }

  return plugins;
}

function resolvePlugins() {
  const plugins = [];

  if (ENABLE_TYPESCRIPT) {
    plugins.push(
      new TsconfigPathsPlugin({
        configFile: tsConfigPath,
        extensions: extensions,
      })
    );
  }

  return plugins;
}

function alias() {
  return aliases.reduce((obj, item) => {
    const [key, value] = Object.entries(item)[0];
    if (typeof value === "string") {
      obj[key] = path.join(servicePath, value);
    } else {
      obj[key] = value;
    }
    return obj;
  }, {});
}

module.exports = {
  entry: resolveEntriesPath(slsw.lib.entries),
  target: "node",
  context: __dirname,
  // Disable verbose logs
  stats: ENABLE_STATS ? "normal" : "errors-only",
  devtool: ENABLE_SOURCE_MAPS ? "source-map" : false,
  externals: computedExternals,
  mode: isLocal ? "development" : "production",
  performance: {
    // Turn off size warnings for entry points
    hints: false,
  },
  resolve: {
    // Performance
    symlinks: false,
    extensions: extensions,
    alias: alias(),
    // First start by looking for modules in the plugin's node_modules
    // before looking inside the project's node_modules.
    modules: [path.resolve(__dirname, "node_modules"), "node_modules"],
    plugins: resolvePlugins(),
  },
  // Add loaders
  module: loaders(),
  // PERFORMANCE ONLY FOR DEVELOPMENT
  optimization: isLocal
    ? {
        nodeEnv: false,
        splitChunks: false,
        removeEmptyChunks: false,
        removeAvailableModules: false,
      }
    : {
        nodeEnv: false,
        minimizer: [
          new ESBuildMinifyPlugin({
            target: esbuildNodeVersion,
          }),
        ],
      },
  plugins: plugins(),
  node: {
    __dirname: false,
  },
};
