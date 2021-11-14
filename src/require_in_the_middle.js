"use strict";
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebpackRequireInTheMiddlePlugin = void 0;
var path_1 = require("path");
var webpack_1 = require("webpack");
var WebpackRequireInTheMiddlePlugin = /** @class */ (function () {
    function WebpackRequireInTheMiddlePlugin(modules, internalModules) {
        this.name = 'WebpackRequireInTheMiddlePlugin';
        this.addShims = true;
        this.modulesMap = new Map();
        this.moduleIds = new Map();
        this.modules = modules !== null && modules !== void 0 ? modules : [];
        this.internalModuleConditions = internalModules !== null && internalModules !== void 0 ? internalModules : [];
    }
    WebpackRequireInTheMiddlePlugin.prototype.apply = function (compiler) {
        var _this = this;
        compiler.hooks.compilation.tap(this.name, function (compilation) { return _this.compilation(compilation); });
    };
    WebpackRequireInTheMiddlePlugin.prototype.compilation = function (compilation) {
        var _this = this;
        compilation.hooks.afterOptimizeModuleIds.tap(this.name, function (modules) { return _this.mapModuleIds(modules); });
        compilation.mainTemplate.hooks.localVars.tap(this.name, function (source) { return _this.addLocalVarSources(source); });
        compilation.mainTemplate.hooks.require.tap(this.name, function (source) { return _this.addRequireSources(source); });
    };
    WebpackRequireInTheMiddlePlugin.prototype.getModuleName = function (filename) {
        if (filename) {
            var segments = filename.split(path_1.sep);
            var index = segments.lastIndexOf('node_modules');
            if (index !== -1 && segments[index + 1]) {
                return segments[index + 1][0] === '@' ? segments[index + 1] + "/" + segments[index + 2] : segments[index + 1];
            }
        }
        return '';
    };
    WebpackRequireInTheMiddlePlugin.prototype.canSkipShimming = function (module) {
        if (module.external && module.request) {
            return this.internalModuleConditions.includes(module.request);
        }
        return false;
    };
    WebpackRequireInTheMiddlePlugin.prototype.includeModule = function (module) {
        var moduleName = this.getModuleName(module.resource);
        return this.modules.length === 0 || (moduleName !== '' && this.modules.includes(moduleName));
    };
    WebpackRequireInTheMiddlePlugin.prototype.mapModuleIds = function (modules) {
        for (var _i = 0, modules_1 = modules; _i < modules_1.length; _i++) {
            var module = modules_1[_i];
            if (this.canSkipShimming(module)) {
                break;
            }
            if (!module.external && module.resource) {
                if (this.includeModule(module)) {
                    this.modulesMap.set(module.id, [path_1.relative(process.cwd() + "/node_modules", module.resource), false]);
                    if (this.getModuleName(module.resource) === module.rawRequest) {
                        this.moduleIds.set(module.rawRequest, module.id);
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        var version = require(process.cwd() +"\\node_modules\\" + module.rawRequest + "\\"+ "package.json").version;
                        this.modulesMap.set(module.id, [path_1.relative(process.cwd() + "/node_modules", module.resource), false, version]);
                    }
                }
                if (module.resource.includes('resolve/index.js')) {
                    this.resolveModuleId = module.id;
                }
            }
            else if (module.request) {
                if (this.modules.includes(module.request)) {
                    this.modulesMap.set(module.id, [module.request, true]);
                }
                if (module.request === 'fs') {
                    this.fsModuleId = module.id;
                }
            }
        }
    };
    WebpackRequireInTheMiddlePlugin.prototype.getRequireShim = function () {
        return [
            'const __ritm_require__ = __ritm_Module__.prototype.require',
            'const __ritm_require_shim__ = function (id) {',
            webpack_1.Template.indent([
                'return modules[id] ? __webpack_require__(id) : __ritm_require__.apply(this, arguments)'
            ]),
            '}',
            '__ritm_Module__.prototype.require = __ritm_require_shim__'
        ];
    };
    WebpackRequireInTheMiddlePlugin.prototype.getResolveFilenameShim = function () {
        return [
            'const __ritm_resolve_filename__ = __ritm_Module__._resolveFilename',
            '__ritm_Module__._resolveFilename = function (id) {',
            webpack_1.Template.indent([
                'if (modules[id] && __ritm_modules_map__.has(id)) {',
                webpack_1.Template.indent([
                    'const [filename, core] = __ritm_modules_map__.get(id)',
                    // eslint-disable-next-line no-template-curly-in-string
                    'return core ? filename : `${process.cwd()}${sep}node_modules${sep}${filename}`'
                ]),
                '}',
                'return __ritm_resolve_filename__.apply(this, arguments)'
            ]),
            '}'
        ];
    };
    WebpackRequireInTheMiddlePlugin.prototype.addLocalVarSources = function (source) {
        return !this.addShims ? source : webpack_1.Template.asString(__spreadArrays([
            source,
            'const { sep } = require("path")',
            "const __ritm_modules_map__ = new Map(" + JSON.stringify(Array.from(this.modulesMap.entries()), null, 2) + ")",
            "const __ritm_module_ids_map__ = new Map(" + JSON.stringify(Array.from(this.moduleIds.entries()), null, 2) + ")",
            'const __ritm_Module__ = module.require("module")'
        ], this.getRequireShim(), this.getResolveFilenameShim(), [
            'const __ritm_shimmed__ = {}'
        ]));
    };
    WebpackRequireInTheMiddlePlugin.prototype.getFsShim = function () {
        if (this.fsModuleId) {
            return [
                "const __ritm_fs_readFileSync__ = __webpack_require__(" + this.fsModuleId + ").readFileSync",
                "installedModules[" + this.fsModuleId + "].exports.readFileSync = function(path) {",
                webpack_1.Template.indent([
                    'const [module, file] = path.split(sep).slice(-2)',
                    'if (file === "package.json" && __ritm_module_ids_map__.has(module)) {',
                    webpack_1.Template.indent([
                        'const version = __ritm_modules_map__.get(__ritm_module_ids_map__.get(module)).slice(-1)',
                        // eslint-disable-next-line no-template-curly-in-string
                        'return `{"version": "${version}"}`'
                    ]),
                    '}',
                    'return __ritm_fs_readFileSync__.apply(this, arguments)'
                ]),
                '}'
            ];
        }
        return [];
    };
    WebpackRequireInTheMiddlePlugin.prototype.getResolveModuleShim = function () {
        if (this.resolveModuleId) {
            return [
                "const __ritm_resolve_sync__ = __webpack_require__(" + this.resolveModuleId + ")",
                "installedModules[" + this.resolveModuleId + "].exports.sync = function(name) {",
                webpack_1.Template.indent([
                    'if (__ritm_module_ids_map__.has(name)) {',
                    webpack_1.Template.indent([
                        'const [filename, core] = __ritm_modules_map__.get(__ritm_module_ids_map__.get(name))',
                        // eslint-disable-next-line no-template-curly-in-string
                        'return core ? filename : `${process.cwd()}${sep}node_modules${sep}${filename}`'
                    ]),
                    '}',
                    'return __ritm_resolve_sync__.apply(this, arguments)'
                ]),
                '}'
            ];
        }
        return [];
    };
    WebpackRequireInTheMiddlePlugin.prototype.getRequireResolveShim = function () {
        return [
            'const __ritm_require_resolve__ = require.resolve',
            'require.resolve = function(name) {',
            webpack_1.Template.indent([
                'if (__ritm_module_ids_map__.has(name)) {',
                webpack_1.Template.indent([
                    'const [filename, core] = __ritm_modules_map__.get(__ritm_module_ids_map__.get(name))',
                    // eslint-disable-next-line no-template-curly-in-string
                    'return core ? filename : `${process.cwd()}${sep}node_modules${sep}${filename}`'
                ]),
                '}',
                'return __ritm_require_resolve__.apply(this, arguments)'
            ]),
            '}'
        ];
    };
    WebpackRequireInTheMiddlePlugin.prototype.getShims = function () {
        return __spreadArrays(this.getFsShim(), this.getResolveModuleShim(), this.getRequireResolveShim());
    };
    WebpackRequireInTheMiddlePlugin.prototype.getResetShims = function () {
        var reset = [];
        if (this.fsModuleId) {
            reset = __spreadArrays(reset, [
                "installedModules[" + this.fsModuleId + "].exports.readFileSync = __ritm_fs_readFileSync__"
            ]);
        }
        if (this.resolveModuleId) {
            reset = __spreadArrays(reset, [
                "installedModules[" + this.resolveModuleId + "].exports.readFileSync = __ritm_resolve_sync__"
            ]);
        }
        return reset;
    };
    WebpackRequireInTheMiddlePlugin.prototype.addRequireSources = function (source) {
        return !this.addShims ? source : webpack_1.Template.asString([
            'if (__ritm_Module__.prototype.require !== __ritm_require_shim__ && !__ritm_shimmed__[moduleId]) {',
            webpack_1.Template.indent([
                '__ritm_shimmed__[moduleId] = true',
                'if (__ritm_modules_map__.has(moduleId)) {',
                webpack_1.Template.indent(__spreadArrays(this.getShims(), [
                    'const exports = __ritm_Module__.prototype.require(moduleId)',
                    'installedModules[moduleId].exports = exports'
                ], this.getResetShims())),
                '}'
            ]),
            '}',
            source
        ]);
    };
    return WebpackRequireInTheMiddlePlugin;
}());
exports.WebpackRequireInTheMiddlePlugin = WebpackRequireInTheMiddlePlugin;
