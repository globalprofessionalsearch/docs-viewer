// NOTE: this was slightly modified from the original.  It should be replaced entirely once a build system is put in place.

(function () {
/**
 * @license almond 0.3.3 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/almond/LICENSE
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part, normalizedBaseParts,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name) {
            name = name.split('/');
            lastIndex = name.length - 1;

            // If wanting node ID compatibility, strip .js from end
            // of IDs. Have to do this here, and not in nameToUrl
            // because node allows either .js or non .js to map
            // to same file.
            if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
            }

            // Starts with a '.' so need the baseName
            if (name[0].charAt(0) === '.' && baseParts) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that 'directory' and not name of the baseName's
                //module. For instance, baseName of 'one/two/three', maps to
                //'one/two/three.js', but we want the directory, 'one/two' for
                //this normalization.
                normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            //start trimDots
            for (i = 0; i < name.length; i++) {
                part = name[i];
                if (part === '.') {
                    name.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && name[2] === '..') || name[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        name.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
            //end trimDots

            name = name.join('/');
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    //Creates a parts array for a relName where first part is plugin ID,
    //second part is resource ID. Assumes relName has already been normalized.
    function makeRelParts(relName) {
        return relName ? splitPrefix(relName) : [];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relParts) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0],
            relResourceName = relParts[1];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relResourceName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relResourceName));
            } else {
                name = normalize(name, relResourceName);
            }
        } else {
            name = normalize(name, relResourceName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i, relParts,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;
        relParts = makeRelParts(relName);

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relParts);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, makeRelParts(callback)).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../node_modules/almond/almond", function(){});

/*
 * Generated by PEG.js 0.10.0.
 *
 * http://pegjs.org/
 */
(function(root, factory) {
  if (typeof define === "function" && define.amd) {
    define('lib/mscgenjs-core/parse/xuparser',[], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  }
})(this, function() {
  "use strict";

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function peg$SyntaxError(message, expected, found, location) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.location = location;
    this.name     = "SyntaxError";

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, peg$SyntaxError);
    }
  }

  peg$subclass(peg$SyntaxError, Error);

  peg$SyntaxError.buildMessage = function(expected, found) {
    var DESCRIBE_EXPECTATION_FNS = {
          literal: function(expectation) {
            return "\"" + literalEscape(expectation.text) + "\"";
          },

          "class": function(expectation) {
            var escapedParts = "",
                i;

            for (i = 0; i < expectation.parts.length; i++) {
              escapedParts += expectation.parts[i] instanceof Array
                ? classEscape(expectation.parts[i][0]) + "-" + classEscape(expectation.parts[i][1])
                : classEscape(expectation.parts[i]);
            }

            return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
          },

          any: function(expectation) {
            return "any character";
          },

          end: function(expectation) {
            return "end of input";
          },

          other: function(expectation) {
            return expectation.description;
          }
        };

    function hex(ch) {
      return ch.charCodeAt(0).toString(16).toUpperCase();
    }

    function literalEscape(s) {
      return s
        .replace(/\\/g, '\\\\')
        .replace(/"/g,  '\\"')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
        .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
    }

    function classEscape(s) {
      return s
        .replace(/\\/g, '\\\\')
        .replace(/\]/g, '\\]')
        .replace(/\^/g, '\\^')
        .replace(/-/g,  '\\-')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
        .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
    }

    function describeExpectation(expectation) {
      return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
    }

    function describeExpected(expected) {
      var descriptions = new Array(expected.length),
          i, j;

      for (i = 0; i < expected.length; i++) {
        descriptions[i] = describeExpectation(expected[i]);
      }

      descriptions.sort();

      if (descriptions.length > 0) {
        for (i = 1, j = 1; i < descriptions.length; i++) {
          if (descriptions[i - 1] !== descriptions[i]) {
            descriptions[j] = descriptions[i];
            j++;
          }
        }
        descriptions.length = j;
      }

      switch (descriptions.length) {
        case 1:
          return descriptions[0];

        case 2:
          return descriptions[0] + " or " + descriptions[1];

        default:
          return descriptions.slice(0, -1).join(", ")
            + ", or "
            + descriptions[descriptions.length - 1];
      }
    }

    function describeFound(found) {
      return found ? "\"" + literalEscape(found) + "\"" : "end of input";
    }

    return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
  };

  function peg$parse(input, options) {
    options = options !== void 0 ? options : {};

    var peg$FAILED = {},

        peg$startRuleFunctions = { program: peg$parseprogram },
        peg$startRuleFunction  = peg$parseprogram,

        peg$c0 = "{",
        peg$c1 = peg$literalExpectation("{", false),
        peg$c2 = "}",
        peg$c3 = peg$literalExpectation("}", false),
        peg$c4 = function(pre, d) {
                d.entities = checkForUndeclaredEntities(d.entities, d.arcs);
                var lRetval = d;

                lRetval = merge ({meta: getMetaInfo(d.options, d.arcs)}, lRetval);

                if (pre.length > 0) {
                    lRetval = merge({precomment: pre}, lRetval);
                }

                return lRetval;
            },
        peg$c5 = "msc",
        peg$c6 = peg$literalExpectation("msc", true),
        peg$c7 = "xu",
        peg$c8 = peg$literalExpectation("xu", true),
        peg$c9 = function(options, entities, arcs) {
                  var lDeclarationList = {};
                  if (options) {
                      lDeclarationList.options = options;
                  }
                  if (entities) {
                      lDeclarationList.entities = entities;
                  }
                  if (arcs) {
                      lDeclarationList.arcs = arcs;
                  }
                  return lDeclarationList;
              },
        peg$c10 = ",",
        peg$c11 = peg$literalExpectation(",", false),
        peg$c12 = function(o) {return o},
        peg$c13 = ";",
        peg$c14 = peg$literalExpectation(";", false),
        peg$c15 = function(options) {
              return optionArray2Object(options[0].concat(options[1]));
            },
        peg$c16 = peg$otherExpectation("option"),
        peg$c17 = "hscale",
        peg$c18 = peg$literalExpectation("hscale", true),
        peg$c19 = "arcgradient",
        peg$c20 = peg$literalExpectation("arcgradient", true),
        peg$c21 = "=",
        peg$c22 = peg$literalExpectation("=", false),
        peg$c23 = function(name, value) {
                    return nameValue2Option(name, value);
                },
        peg$c24 = "width",
        peg$c25 = peg$literalExpectation("width", true),
        peg$c26 = "wordwraparcs",
        peg$c27 = peg$literalExpectation("wordwraparcs", true),
        peg$c28 = function(name, value) {
                    return nameValue2Option(name, flattenBoolean(value));
                },
        peg$c29 = "wordwrapentities",
        peg$c30 = peg$literalExpectation("wordwrapentities", true),
        peg$c31 = "wordwrapboxes",
        peg$c32 = peg$literalExpectation("wordwrapboxes", true),
        peg$c33 = "watermark",
        peg$c34 = peg$literalExpectation("watermark", true),
        peg$c35 = function(e) {return e},
        peg$c36 = function(el) {
              return el[0].concat(el[1]);
            },
        peg$c37 = peg$otherExpectation("entity"),
        peg$c38 = "[",
        peg$c39 = peg$literalExpectation("[", false),
        peg$c40 = "]",
        peg$c41 = peg$literalExpectation("]", false),
        peg$c42 = function(name, a) {return a},
        peg$c43 = function(name, attrList) {
                    return merge ({name:name}, attrList);
                },
        peg$c44 = function(name, attrList) {
                  if (isMscGenKeyword(name)){
                    error("MscGen keywords aren't allowed as entity names (embed them in quotes if you need them)");
                  }
                  return merge ({name:name}, attrList);
                },
        peg$c45 = function(a) {return a},
        peg$c46 = function(al) {
               return al[0].concat(al[1]);
            },
        peg$c47 = function(a, al) {return al},
        peg$c48 = function(a, al) {
              return merge (a, al);
            },
        peg$c49 = function(kind) {return {kind:kind}},
        peg$c50 = function(from, kind, to) {return {kind: kind, from:from, to:to, location:location()}},
        peg$c51 = "*",
        peg$c52 = peg$literalExpectation("*", false),
        peg$c53 = function(kind, to) {return {kind:kind, from: "*", to:to, location:location()}},
        peg$c54 = function(from, kind) {return {kind:kind, from: from, to:"*", location:location()}},
        peg$c55 = function(from, kind, to, al) {return al},
        peg$c56 = function(from, kind, to, al, arclist) {
                    return merge (
                        {
                            kind     : kind,
                            from     : from,
                            to       : to,
                            location : location(),
                            arcs     : arclist
                        },
                        al
                    );
                },
        peg$c57 = peg$otherExpectation("empty row"),
        peg$c58 = "|||",
        peg$c59 = peg$literalExpectation("|||", false),
        peg$c60 = "...",
        peg$c61 = peg$literalExpectation("...", false),
        peg$c62 = peg$otherExpectation("---"),
        peg$c63 = "---",
        peg$c64 = peg$literalExpectation("---", false),
        peg$c65 = function(kind) {return kind.toLowerCase()},
        peg$c66 = peg$otherExpectation("bi-directional arrow"),
        peg$c67 = "--",
        peg$c68 = peg$literalExpectation("--", false),
        peg$c69 = "<->",
        peg$c70 = peg$literalExpectation("<->", false),
        peg$c71 = "==",
        peg$c72 = peg$literalExpectation("==", false),
        peg$c73 = "<<=>>",
        peg$c74 = peg$literalExpectation("<<=>>", false),
        peg$c75 = "<=>",
        peg$c76 = peg$literalExpectation("<=>", false),
        peg$c77 = "..",
        peg$c78 = peg$literalExpectation("..", false),
        peg$c79 = "<<>>",
        peg$c80 = peg$literalExpectation("<<>>", false),
        peg$c81 = "::",
        peg$c82 = peg$literalExpectation("::", false),
        peg$c83 = "<:>",
        peg$c84 = peg$literalExpectation("<:>", false),
        peg$c85 = peg$otherExpectation("left to right arrow"),
        peg$c86 = "->",
        peg$c87 = peg$literalExpectation("->", false),
        peg$c88 = "=>>",
        peg$c89 = peg$literalExpectation("=>>", false),
        peg$c90 = "=>",
        peg$c91 = peg$literalExpectation("=>", false),
        peg$c92 = ">>",
        peg$c93 = peg$literalExpectation(">>", false),
        peg$c94 = ":>",
        peg$c95 = peg$literalExpectation(":>", false),
        peg$c96 = "-x",
        peg$c97 = peg$literalExpectation("-x", true),
        peg$c98 = peg$otherExpectation("right to left arrow"),
        peg$c99 = "<-",
        peg$c100 = peg$literalExpectation("<-", false),
        peg$c101 = "<<=",
        peg$c102 = peg$literalExpectation("<<=", false),
        peg$c103 = "<=",
        peg$c104 = peg$literalExpectation("<=", false),
        peg$c105 = "<<",
        peg$c106 = peg$literalExpectation("<<", false),
        peg$c107 = "<:",
        peg$c108 = peg$literalExpectation("<:", false),
        peg$c109 = "x-",
        peg$c110 = peg$literalExpectation("x-", true),
        peg$c111 = peg$otherExpectation("box"),
        peg$c112 = "note",
        peg$c113 = peg$literalExpectation("note", true),
        peg$c114 = "abox",
        peg$c115 = peg$literalExpectation("abox", true),
        peg$c116 = "rbox",
        peg$c117 = peg$literalExpectation("rbox", true),
        peg$c118 = "box",
        peg$c119 = peg$literalExpectation("box", true),
        peg$c120 = peg$otherExpectation("inline expression"),
        peg$c121 = "alt",
        peg$c122 = peg$literalExpectation("alt", true),
        peg$c123 = "else",
        peg$c124 = peg$literalExpectation("else", true),
        peg$c125 = "opt",
        peg$c126 = peg$literalExpectation("opt", true),
        peg$c127 = "break",
        peg$c128 = peg$literalExpectation("break", true),
        peg$c129 = "par",
        peg$c130 = peg$literalExpectation("par", true),
        peg$c131 = "seq",
        peg$c132 = peg$literalExpectation("seq", true),
        peg$c133 = "strict",
        peg$c134 = peg$literalExpectation("strict", true),
        peg$c135 = "neg",
        peg$c136 = peg$literalExpectation("neg", true),
        peg$c137 = "critical",
        peg$c138 = peg$literalExpectation("critical", true),
        peg$c139 = "ignore",
        peg$c140 = peg$literalExpectation("ignore", true),
        peg$c141 = "consider",
        peg$c142 = peg$literalExpectation("consider", true),
        peg$c143 = "assert",
        peg$c144 = peg$literalExpectation("assert", true),
        peg$c145 = "loop",
        peg$c146 = peg$literalExpectation("loop", true),
        peg$c147 = "ref",
        peg$c148 = peg$literalExpectation("ref", true),
        peg$c149 = "exc",
        peg$c150 = peg$literalExpectation("exc", true),
        peg$c151 = function(kind) {
                return kind.toLowerCase()
            },
        peg$c152 = function(attributes) {
              return optionArray2Object(attributes[0].concat(attributes[1]));
            },
        peg$c153 = function(name, value) {
              var lAttribute = {};
              lAttribute[name.toLowerCase().replace("colour", "color")] = value;
              return lAttribute
            },
        peg$c154 = peg$otherExpectation("attribute name"),
        peg$c155 = "label",
        peg$c156 = peg$literalExpectation("label", true),
        peg$c157 = "idurl",
        peg$c158 = peg$literalExpectation("idurl", true),
        peg$c159 = "id",
        peg$c160 = peg$literalExpectation("id", true),
        peg$c161 = "url",
        peg$c162 = peg$literalExpectation("url", true),
        peg$c163 = "linecolor",
        peg$c164 = peg$literalExpectation("linecolor", true),
        peg$c165 = "linecolour",
        peg$c166 = peg$literalExpectation("linecolour", true),
        peg$c167 = "textcolor",
        peg$c168 = peg$literalExpectation("textcolor", true),
        peg$c169 = "textcolour",
        peg$c170 = peg$literalExpectation("textcolour", true),
        peg$c171 = "textbgcolor",
        peg$c172 = peg$literalExpectation("textbgcolor", true),
        peg$c173 = "textbgcolour",
        peg$c174 = peg$literalExpectation("textbgcolour", true),
        peg$c175 = "arclinecolor",
        peg$c176 = peg$literalExpectation("arclinecolor", true),
        peg$c177 = "arclinecolour",
        peg$c178 = peg$literalExpectation("arclinecolour", true),
        peg$c179 = "arctextcolor",
        peg$c180 = peg$literalExpectation("arctextcolor", true),
        peg$c181 = "arctextcolour",
        peg$c182 = peg$literalExpectation("arctextcolour", true),
        peg$c183 = "arctextbgcolor",
        peg$c184 = peg$literalExpectation("arctextbgcolor", true),
        peg$c185 = "arctextbgcolour",
        peg$c186 = peg$literalExpectation("arctextbgcolour", true),
        peg$c187 = "arcskip",
        peg$c188 = peg$literalExpectation("arcskip", true),
        peg$c189 = "title",
        peg$c190 = peg$literalExpectation("title", true),
        peg$c191 = peg$otherExpectation("double quoted string"),
        peg$c192 = "\"",
        peg$c193 = peg$literalExpectation("\"", false),
        peg$c194 = function(s) {return s.join("")},
        peg$c195 = "\\\"",
        peg$c196 = peg$literalExpectation("\\\"", false),
        peg$c197 = peg$anyExpectation(),
        peg$c198 = function(c) {return c},
        peg$c199 = peg$otherExpectation("identifier"),
        peg$c200 = /^[A-Za-z_0-9]/,
        peg$c201 = peg$classExpectation([["A", "Z"], ["a", "z"], "_", ["0", "9"]], false, false),
        peg$c202 = function(letters) {return letters.join("")},
        peg$c203 = peg$otherExpectation("whitespace"),
        peg$c204 = /^[ \t]/,
        peg$c205 = peg$classExpectation([" ", "\t"], false, false),
        peg$c206 = peg$otherExpectation("lineend"),
        peg$c207 = /^[\r\n]/,
        peg$c208 = peg$classExpectation(["\r", "\n"], false, false),
        peg$c209 = "/*",
        peg$c210 = peg$literalExpectation("/*", false),
        peg$c211 = "*/",
        peg$c212 = peg$literalExpectation("*/", false),
        peg$c213 = function(start, com, end) {
              return start + com.join("") + end
            },
        peg$c214 = "//",
        peg$c215 = peg$literalExpectation("//", false),
        peg$c216 = "#",
        peg$c217 = peg$literalExpectation("#", false),
        peg$c218 = /^[^\r\n]/,
        peg$c219 = peg$classExpectation(["\r", "\n"], true, false),
        peg$c220 = function(start, com) {
              return start + com.join("")
            },
        peg$c221 = peg$otherExpectation("comment"),
        peg$c222 = peg$otherExpectation("number"),
        peg$c223 = function(s) { return s; },
        peg$c224 = function(i) { return i.toString(); },
        peg$c225 = function(s) { return s.toString(); },
        peg$c226 = /^[0-9]/,
        peg$c227 = peg$classExpectation([["0", "9"]], false, false),
        peg$c228 = function(digits) { return parseInt(digits.join(""), 10); },
        peg$c229 = ".",
        peg$c230 = peg$literalExpectation(".", false),
        peg$c231 = function(digits) { return parseFloat(digits.join("")); },
        peg$c232 = peg$otherExpectation("boolean"),
        peg$c233 = function(bs) {return bs;},
        peg$c234 = function(b) {return b.toString();},
        peg$c235 = "true",
        peg$c236 = peg$literalExpectation("true", true),
        peg$c237 = "false",
        peg$c238 = peg$literalExpectation("false", true),
        peg$c239 = "on",
        peg$c240 = peg$literalExpectation("on", true),
        peg$c241 = "off",
        peg$c242 = peg$literalExpectation("off", true),
        peg$c243 = "0",
        peg$c244 = peg$literalExpectation("0", false),
        peg$c245 = "1",
        peg$c246 = peg$literalExpectation("1", false),
        peg$c247 = peg$otherExpectation("size"),
        peg$c248 = function(n) {return n.toString(); },
        peg$c249 = "auto",
        peg$c250 = peg$literalExpectation("auto", true),
        peg$c251 = function(s) {return s.toLowerCase(); },

        peg$currPos          = 0,
        peg$savedPos         = 0,
        peg$posDetailsCache  = [{ line: 1, column: 1 }],
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$savedPos, peg$currPos);
    }

    function location() {
      return peg$computeLocation(peg$savedPos, peg$currPos);
    }

    function expected(description, location) {
      location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

      throw peg$buildStructuredError(
        [peg$otherExpectation(description)],
        input.substring(peg$savedPos, peg$currPos),
        location
      );
    }

    function error(message, location) {
      location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

      throw peg$buildSimpleError(message, location);
    }

    function peg$literalExpectation(text, ignoreCase) {
      return { type: "literal", text: text, ignoreCase: ignoreCase };
    }

    function peg$classExpectation(parts, inverted, ignoreCase) {
      return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
    }

    function peg$anyExpectation() {
      return { type: "any" };
    }

    function peg$endExpectation() {
      return { type: "end" };
    }

    function peg$otherExpectation(description) {
      return { type: "other", description: description };
    }

    function peg$computePosDetails(pos) {
      var details = peg$posDetailsCache[pos], p;

      if (details) {
        return details;
      } else {
        p = pos - 1;
        while (!peg$posDetailsCache[p]) {
          p--;
        }

        details = peg$posDetailsCache[p];
        details = {
          line:   details.line,
          column: details.column
        };

        while (p < pos) {
          if (input.charCodeAt(p) === 10) {
            details.line++;
            details.column = 1;
          } else {
            details.column++;
          }

          p++;
        }

        peg$posDetailsCache[pos] = details;
        return details;
      }
    }

    function peg$computeLocation(startPos, endPos) {
      var startPosDetails = peg$computePosDetails(startPos),
          endPosDetails   = peg$computePosDetails(endPos);

      return {
        start: {
          offset: startPos,
          line:   startPosDetails.line,
          column: startPosDetails.column
        },
        end: {
          offset: endPos,
          line:   endPosDetails.line,
          column: endPosDetails.column
        }
      };
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildSimpleError(message, location) {
      return new peg$SyntaxError(message, null, null, location);
    }

    function peg$buildStructuredError(expected, found, location) {
      return new peg$SyntaxError(
        peg$SyntaxError.buildMessage(expected, found),
        expected,
        found,
        location
      );
    }

    function peg$parseprogram() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsestarttoken();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 123) {
              s4 = peg$c0;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c1); }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parsedeclarationlist();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 125) {
                      s8 = peg$c2;
                      peg$currPos++;
                    } else {
                      s8 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c3); }
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = peg$parse_();
                      if (s9 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c4(s1, s6);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsestarttoken() {
      var s0;

      if (input.substr(peg$currPos, 3).toLowerCase() === peg$c5) {
        s0 = input.substr(peg$currPos, 3);
        peg$currPos += 3;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c6); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 2).toLowerCase() === peg$c7) {
          s0 = input.substr(peg$currPos, 2);
          peg$currPos += 2;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c8); }
        }
      }

      return s0;
    }

    function peg$parsedeclarationlist() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseoptionlist();
      if (s1 === peg$FAILED) {
        s1 = null;
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseentitylist();
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearclist();
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c9(s1, s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseoptionlist() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseoption();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c10;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c11); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c12(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseoption();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c10;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c11); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c12(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseoption();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s5 = peg$c13;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c14); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c12(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c15(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseoption() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6).toLowerCase() === peg$c17) {
          s2 = input.substr(peg$currPos, 6);
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c18); }
        }
        if (s2 === peg$FAILED) {
          if (input.substr(peg$currPos, 11).toLowerCase() === peg$c19) {
            s2 = input.substr(peg$currPos, 11);
            peg$currPos += 11;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c20); }
          }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s4 = peg$c21;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c22); }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parsenumberlike();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c23(s2, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.substr(peg$currPos, 5).toLowerCase() === peg$c24) {
            s2 = input.substr(peg$currPos, 5);
            peg$currPos += 5;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c25); }
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 61) {
                s4 = peg$c21;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c22); }
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parse_();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parsesizelike();
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parse_();
                    if (s7 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c23(s2, s6);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parse_();
          if (s1 !== peg$FAILED) {
            if (input.substr(peg$currPos, 12).toLowerCase() === peg$c26) {
              s2 = input.substr(peg$currPos, 12);
              peg$currPos += 12;
            } else {
              s2 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c27); }
            }
            if (s2 !== peg$FAILED) {
              s3 = peg$parse_();
              if (s3 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 61) {
                  s4 = peg$c21;
                  peg$currPos++;
                } else {
                  s4 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c22); }
                }
                if (s4 !== peg$FAILED) {
                  s5 = peg$parse_();
                  if (s5 !== peg$FAILED) {
                    s6 = peg$parsebooleanlike();
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parse_();
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c28(s2, s6);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parse_();
            if (s1 !== peg$FAILED) {
              if (input.substr(peg$currPos, 16).toLowerCase() === peg$c29) {
                s2 = input.substr(peg$currPos, 16);
                peg$currPos += 16;
              } else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c30); }
              }
              if (s2 !== peg$FAILED) {
                s3 = peg$parse_();
                if (s3 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 61) {
                    s4 = peg$c21;
                    peg$currPos++;
                  } else {
                    s4 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c22); }
                  }
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parse_();
                    if (s5 !== peg$FAILED) {
                      s6 = peg$parsebooleanlike();
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parse_();
                        if (s7 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c28(s2, s6);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parse_();
              if (s1 !== peg$FAILED) {
                if (input.substr(peg$currPos, 13).toLowerCase() === peg$c31) {
                  s2 = input.substr(peg$currPos, 13);
                  peg$currPos += 13;
                } else {
                  s2 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c32); }
                }
                if (s2 !== peg$FAILED) {
                  s3 = peg$parse_();
                  if (s3 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 61) {
                      s4 = peg$c21;
                      peg$currPos++;
                    } else {
                      s4 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c22); }
                    }
                    if (s4 !== peg$FAILED) {
                      s5 = peg$parse_();
                      if (s5 !== peg$FAILED) {
                        s6 = peg$parsebooleanlike();
                        if (s6 !== peg$FAILED) {
                          s7 = peg$parse_();
                          if (s7 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c28(s2, s6);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                s1 = peg$parse_();
                if (s1 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 9).toLowerCase() === peg$c33) {
                    s2 = input.substr(peg$currPos, 9);
                    peg$currPos += 9;
                  } else {
                    s2 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c34); }
                  }
                  if (s2 !== peg$FAILED) {
                    s3 = peg$parse_();
                    if (s3 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 61) {
                        s4 = peg$c21;
                        peg$currPos++;
                      } else {
                        s4 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c22); }
                      }
                      if (s4 !== peg$FAILED) {
                        s5 = peg$parse_();
                        if (s5 !== peg$FAILED) {
                          s6 = peg$parsestring();
                          if (s6 !== peg$FAILED) {
                            s7 = peg$parse_();
                            if (s7 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c23(s2, s6);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c16); }
      }

      return s0;
    }

    function peg$parseentitylist() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseentity();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c10;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c11); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c35(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseentity();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c10;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c11); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c35(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseentity();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s5 = peg$c13;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c14); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c35(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c36(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseentity() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsestring();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$currPos;
            if (input.charCodeAt(peg$currPos) === 91) {
              s5 = peg$c38;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c39); }
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parseattributelist();
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 93) {
                  s7 = peg$c40;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c41); }
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s4;
                  s5 = peg$c42(s2, s6);
                  s4 = s5;
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
            if (s4 === peg$FAILED) {
              s4 = null;
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c43(s2, s4);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          s2 = peg$parsequotelessidentifier();
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              s4 = peg$currPos;
              if (input.charCodeAt(peg$currPos) === 91) {
                s5 = peg$c38;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c39); }
              }
              if (s5 !== peg$FAILED) {
                s6 = peg$parseattributelist();
                if (s6 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 93) {
                    s7 = peg$c40;
                    peg$currPos++;
                  } else {
                    s7 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c41); }
                  }
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s4;
                    s5 = peg$c42(s2, s6);
                    s4 = s5;
                  } else {
                    peg$currPos = s4;
                    s4 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
              if (s4 === peg$FAILED) {
                s4 = null;
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parse_();
                if (s5 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c44(s2, s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c37); }
      }

      return s0;
    }

    function peg$parsearclist() {
      var s0, s1, s2, s3, s4;

      s0 = [];
      s1 = peg$currPos;
      s2 = peg$parsearcline();
      if (s2 !== peg$FAILED) {
        s3 = peg$parse_();
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s4 = peg$c13;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c14); }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c45(s2);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        while (s1 !== peg$FAILED) {
          s0.push(s1);
          s1 = peg$currPos;
          s2 = peg$parsearcline();
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 59) {
                s4 = peg$c13;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c14); }
              }
              if (s4 !== peg$FAILED) {
                peg$savedPos = s1;
                s2 = peg$c45(s2);
                s1 = s2;
              } else {
                peg$currPos = s1;
                s1 = peg$FAILED;
              }
            } else {
              peg$currPos = s1;
              s1 = peg$FAILED;
            }
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        }
      } else {
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsearcline() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parsearc();
      if (s4 !== peg$FAILED) {
        s5 = peg$parse_();
        if (s5 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s6 = peg$c10;
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c11); }
          }
          if (s6 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c45(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parsearc();
        if (s4 !== peg$FAILED) {
          s5 = peg$parse_();
          if (s5 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 44) {
              s6 = peg$c10;
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c11); }
            }
            if (s6 !== peg$FAILED) {
              peg$savedPos = s3;
              s4 = peg$c45(s4);
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parsearc();
        if (s4 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c45(s4);
        }
        s3 = s4;
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c46(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsearc() {
      var s0;

      s0 = peg$parseregulararc();
      if (s0 === peg$FAILED) {
        s0 = peg$parsespanarc();
      }

      return s0;
    }

    function peg$parseregulararc() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$parsesinglearc();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s1;
        s2 = peg$c45(s2);
      }
      s1 = s2;
      if (s1 === peg$FAILED) {
        s1 = peg$currPos;
        s2 = peg$parsedualarc();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c45(s2);
        }
        s1 = s2;
        if (s1 === peg$FAILED) {
          s1 = peg$currPos;
          s2 = peg$parsecommentarc();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c45(s2);
          }
          s1 = s2;
        }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 91) {
          s3 = peg$c38;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c39); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseattributelist();
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 93) {
              s5 = peg$c40;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c41); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s2;
              s3 = peg$c47(s1, s4);
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c48(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesinglearc() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesinglearctoken();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c49(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsecommentarc() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecommenttoken();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c49(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsedualarc() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsedualarctoken();
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c50(s2, s4, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 42) {
            s2 = peg$c51;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c52); }
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              s4 = peg$parsebckarrowtoken();
              if (s4 !== peg$FAILED) {
                s5 = peg$parse_();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parseidentifier();
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parse_();
                    if (s7 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c53(s4, s6);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parse_();
          if (s1 !== peg$FAILED) {
            s2 = peg$parseidentifier();
            if (s2 !== peg$FAILED) {
              s3 = peg$parse_();
              if (s3 !== peg$FAILED) {
                s4 = peg$parsefwdarrowtoken();
                if (s4 !== peg$FAILED) {
                  s5 = peg$parse_();
                  if (s5 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 42) {
                      s6 = peg$c51;
                      peg$currPos++;
                    } else {
                      s6 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c52); }
                    }
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parse_();
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c54(s2, s4);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parse_();
            if (s1 !== peg$FAILED) {
              s2 = peg$parseidentifier();
              if (s2 !== peg$FAILED) {
                s3 = peg$parse_();
                if (s3 !== peg$FAILED) {
                  s4 = peg$parsebidiarrowtoken();
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parse_();
                    if (s5 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 42) {
                        s6 = peg$c51;
                        peg$currPos++;
                      } else {
                        s6 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c52); }
                      }
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parse_();
                        if (s7 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c54(s2, s4);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          }
        }
      }

      return s0;
    }

    function peg$parsespanarc() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsespanarctoken();
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    s8 = peg$currPos;
                    if (input.charCodeAt(peg$currPos) === 91) {
                      s9 = peg$c38;
                      peg$currPos++;
                    } else {
                      s9 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c39); }
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parseattributelist();
                      if (s10 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 93) {
                          s11 = peg$c40;
                          peg$currPos++;
                        } else {
                          s11 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c41); }
                        }
                        if (s11 !== peg$FAILED) {
                          peg$savedPos = s8;
                          s9 = peg$c55(s2, s4, s6, s10);
                          s8 = s9;
                        } else {
                          peg$currPos = s8;
                          s8 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s8;
                        s8 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                    if (s8 === peg$FAILED) {
                      s8 = null;
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = peg$parse_();
                      if (s9 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 123) {
                          s10 = peg$c0;
                          peg$currPos++;
                        } else {
                          s10 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c1); }
                        }
                        if (s10 !== peg$FAILED) {
                          s11 = peg$parse_();
                          if (s11 !== peg$FAILED) {
                            s12 = peg$parsearclist();
                            if (s12 === peg$FAILED) {
                              s12 = null;
                            }
                            if (s12 !== peg$FAILED) {
                              s13 = peg$parse_();
                              if (s13 !== peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 125) {
                                  s14 = peg$c2;
                                  peg$currPos++;
                                } else {
                                  s14 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c3); }
                                }
                                if (s14 !== peg$FAILED) {
                                  s15 = peg$parse_();
                                  if (s15 !== peg$FAILED) {
                                    peg$savedPos = s0;
                                    s1 = peg$c56(s2, s4, s6, s8, s12);
                                    s0 = s1;
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesinglearctoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 3) === peg$c58) {
        s0 = peg$c58;
        peg$currPos += 3;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c59); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c60) {
          s0 = peg$c60;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c61); }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c57); }
      }

      return s0;
    }

    function peg$parsecommenttoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 3) === peg$c63) {
        s0 = peg$c63;
        peg$currPos += 3;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c64); }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c62); }
      }

      return s0;
    }

    function peg$parsedualarctoken() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsebidiarrowtoken();
      if (s1 === peg$FAILED) {
        s1 = peg$parsefwdarrowtoken();
        if (s1 === peg$FAILED) {
          s1 = peg$parsebckarrowtoken();
          if (s1 === peg$FAILED) {
            s1 = peg$parseboxtoken();
          }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c65(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebidiarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c67) {
        s0 = peg$c67;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c68); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c69) {
          s0 = peg$c69;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c70); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c71) {
            s0 = peg$c71;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c72); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 5) === peg$c73) {
              s0 = peg$c73;
              peg$currPos += 5;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c74); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 3) === peg$c75) {
                s0 = peg$c75;
                peg$currPos += 3;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c76); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c77) {
                  s0 = peg$c77;
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c78); }
                }
                if (s0 === peg$FAILED) {
                  if (input.substr(peg$currPos, 4) === peg$c79) {
                    s0 = peg$c79;
                    peg$currPos += 4;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c80); }
                  }
                  if (s0 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c81) {
                      s0 = peg$c81;
                      peg$currPos += 2;
                    } else {
                      s0 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c82); }
                    }
                    if (s0 === peg$FAILED) {
                      if (input.substr(peg$currPos, 3) === peg$c83) {
                        s0 = peg$c83;
                        peg$currPos += 3;
                      } else {
                        s0 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c84); }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c66); }
      }

      return s0;
    }

    function peg$parsefwdarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c86) {
        s0 = peg$c86;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c87); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c88) {
          s0 = peg$c88;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c89); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c90) {
            s0 = peg$c90;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c91); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c92) {
              s0 = peg$c92;
              peg$currPos += 2;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c93); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 2) === peg$c94) {
                s0 = peg$c94;
                peg$currPos += 2;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c95); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2).toLowerCase() === peg$c96) {
                  s0 = input.substr(peg$currPos, 2);
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c97); }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c85); }
      }

      return s0;
    }

    function peg$parsebckarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c99) {
        s0 = peg$c99;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c100); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c101) {
          s0 = peg$c101;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c102); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c103) {
            s0 = peg$c103;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c104); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c105) {
              s0 = peg$c105;
              peg$currPos += 2;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c106); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 2) === peg$c107) {
                s0 = peg$c107;
                peg$currPos += 2;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c108); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2).toLowerCase() === peg$c109) {
                  s0 = input.substr(peg$currPos, 2);
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c110); }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c98); }
      }

      return s0;
    }

    function peg$parseboxtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 4).toLowerCase() === peg$c112) {
        s0 = input.substr(peg$currPos, 4);
        peg$currPos += 4;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c113); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c114) {
          s0 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c115); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 4).toLowerCase() === peg$c116) {
            s0 = input.substr(peg$currPos, 4);
            peg$currPos += 4;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c117); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 3).toLowerCase() === peg$c118) {
              s0 = input.substr(peg$currPos, 3);
              peg$currPos += 3;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c119); }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c111); }
      }

      return s0;
    }

    function peg$parsespanarctoken() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 3).toLowerCase() === peg$c121) {
        s1 = input.substr(peg$currPos, 3);
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c122); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c123) {
          s1 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c124); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 3).toLowerCase() === peg$c125) {
            s1 = input.substr(peg$currPos, 3);
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c126); }
          }
          if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 5).toLowerCase() === peg$c127) {
              s1 = input.substr(peg$currPos, 5);
              peg$currPos += 5;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c128); }
            }
            if (s1 === peg$FAILED) {
              if (input.substr(peg$currPos, 3).toLowerCase() === peg$c129) {
                s1 = input.substr(peg$currPos, 3);
                peg$currPos += 3;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c130); }
              }
              if (s1 === peg$FAILED) {
                if (input.substr(peg$currPos, 3).toLowerCase() === peg$c131) {
                  s1 = input.substr(peg$currPos, 3);
                  peg$currPos += 3;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c132); }
                }
                if (s1 === peg$FAILED) {
                  if (input.substr(peg$currPos, 6).toLowerCase() === peg$c133) {
                    s1 = input.substr(peg$currPos, 6);
                    peg$currPos += 6;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c134); }
                  }
                  if (s1 === peg$FAILED) {
                    if (input.substr(peg$currPos, 3).toLowerCase() === peg$c135) {
                      s1 = input.substr(peg$currPos, 3);
                      peg$currPos += 3;
                    } else {
                      s1 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c136); }
                    }
                    if (s1 === peg$FAILED) {
                      if (input.substr(peg$currPos, 8).toLowerCase() === peg$c137) {
                        s1 = input.substr(peg$currPos, 8);
                        peg$currPos += 8;
                      } else {
                        s1 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c138); }
                      }
                      if (s1 === peg$FAILED) {
                        if (input.substr(peg$currPos, 6).toLowerCase() === peg$c139) {
                          s1 = input.substr(peg$currPos, 6);
                          peg$currPos += 6;
                        } else {
                          s1 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c140); }
                        }
                        if (s1 === peg$FAILED) {
                          if (input.substr(peg$currPos, 8).toLowerCase() === peg$c141) {
                            s1 = input.substr(peg$currPos, 8);
                            peg$currPos += 8;
                          } else {
                            s1 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c142); }
                          }
                          if (s1 === peg$FAILED) {
                            if (input.substr(peg$currPos, 6).toLowerCase() === peg$c143) {
                              s1 = input.substr(peg$currPos, 6);
                              peg$currPos += 6;
                            } else {
                              s1 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c144); }
                            }
                            if (s1 === peg$FAILED) {
                              if (input.substr(peg$currPos, 4).toLowerCase() === peg$c145) {
                                s1 = input.substr(peg$currPos, 4);
                                peg$currPos += 4;
                              } else {
                                s1 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c146); }
                              }
                              if (s1 === peg$FAILED) {
                                if (input.substr(peg$currPos, 3).toLowerCase() === peg$c147) {
                                  s1 = input.substr(peg$currPos, 3);
                                  peg$currPos += 3;
                                } else {
                                  s1 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c148); }
                                }
                                if (s1 === peg$FAILED) {
                                  if (input.substr(peg$currPos, 3).toLowerCase() === peg$c149) {
                                    s1 = input.substr(peg$currPos, 3);
                                    peg$currPos += 3;
                                  } else {
                                    s1 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c150); }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c151(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c120); }
      }

      return s0;
    }

    function peg$parseattributelist() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseattribute();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c10;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c11); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c45(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseattribute();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c10;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c11); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c45(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseattribute();
        if (s4 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c45(s4);
        }
        s3 = s4;
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c152(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseattribute() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseattributename();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s4 = peg$c21;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c22); }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c153(s2, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseattributename() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 5).toLowerCase() === peg$c155) {
        s0 = input.substr(peg$currPos, 5);
        peg$currPos += 5;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c156); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 5).toLowerCase() === peg$c157) {
          s0 = input.substr(peg$currPos, 5);
          peg$currPos += 5;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c158); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2).toLowerCase() === peg$c159) {
            s0 = input.substr(peg$currPos, 2);
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c160); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 3).toLowerCase() === peg$c161) {
              s0 = input.substr(peg$currPos, 3);
              peg$currPos += 3;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c162); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 9).toLowerCase() === peg$c163) {
                s0 = input.substr(peg$currPos, 9);
                peg$currPos += 9;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c164); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 10).toLowerCase() === peg$c165) {
                  s0 = input.substr(peg$currPos, 10);
                  peg$currPos += 10;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c166); }
                }
                if (s0 === peg$FAILED) {
                  if (input.substr(peg$currPos, 9).toLowerCase() === peg$c167) {
                    s0 = input.substr(peg$currPos, 9);
                    peg$currPos += 9;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c168); }
                  }
                  if (s0 === peg$FAILED) {
                    if (input.substr(peg$currPos, 10).toLowerCase() === peg$c169) {
                      s0 = input.substr(peg$currPos, 10);
                      peg$currPos += 10;
                    } else {
                      s0 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c170); }
                    }
                    if (s0 === peg$FAILED) {
                      if (input.substr(peg$currPos, 11).toLowerCase() === peg$c171) {
                        s0 = input.substr(peg$currPos, 11);
                        peg$currPos += 11;
                      } else {
                        s0 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c172); }
                      }
                      if (s0 === peg$FAILED) {
                        if (input.substr(peg$currPos, 12).toLowerCase() === peg$c173) {
                          s0 = input.substr(peg$currPos, 12);
                          peg$currPos += 12;
                        } else {
                          s0 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c174); }
                        }
                        if (s0 === peg$FAILED) {
                          if (input.substr(peg$currPos, 12).toLowerCase() === peg$c175) {
                            s0 = input.substr(peg$currPos, 12);
                            peg$currPos += 12;
                          } else {
                            s0 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c176); }
                          }
                          if (s0 === peg$FAILED) {
                            if (input.substr(peg$currPos, 13).toLowerCase() === peg$c177) {
                              s0 = input.substr(peg$currPos, 13);
                              peg$currPos += 13;
                            } else {
                              s0 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c178); }
                            }
                            if (s0 === peg$FAILED) {
                              if (input.substr(peg$currPos, 12).toLowerCase() === peg$c179) {
                                s0 = input.substr(peg$currPos, 12);
                                peg$currPos += 12;
                              } else {
                                s0 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c180); }
                              }
                              if (s0 === peg$FAILED) {
                                if (input.substr(peg$currPos, 13).toLowerCase() === peg$c181) {
                                  s0 = input.substr(peg$currPos, 13);
                                  peg$currPos += 13;
                                } else {
                                  s0 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c182); }
                                }
                                if (s0 === peg$FAILED) {
                                  if (input.substr(peg$currPos, 14).toLowerCase() === peg$c183) {
                                    s0 = input.substr(peg$currPos, 14);
                                    peg$currPos += 14;
                                  } else {
                                    s0 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c184); }
                                  }
                                  if (s0 === peg$FAILED) {
                                    if (input.substr(peg$currPos, 15).toLowerCase() === peg$c185) {
                                      s0 = input.substr(peg$currPos, 15);
                                      peg$currPos += 15;
                                    } else {
                                      s0 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c186); }
                                    }
                                    if (s0 === peg$FAILED) {
                                      if (input.substr(peg$currPos, 7).toLowerCase() === peg$c187) {
                                        s0 = input.substr(peg$currPos, 7);
                                        peg$currPos += 7;
                                      } else {
                                        s0 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c188); }
                                      }
                                      if (s0 === peg$FAILED) {
                                        if (input.substr(peg$currPos, 5).toLowerCase() === peg$c189) {
                                          s0 = input.substr(peg$currPos, 5);
                                          peg$currPos += 5;
                                        } else {
                                          s0 = peg$FAILED;
                                          if (peg$silentFails === 0) { peg$fail(peg$c190); }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c154); }
      }

      return s0;
    }

    function peg$parsestring() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c192;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsestringcontent();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c192;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c193); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c194(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c191); }
      }

      return s0;
    }

    function peg$parsestringcontent() {
      var s0, s1, s2, s3;

      s0 = [];
      s1 = peg$currPos;
      s2 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 34) {
        s3 = peg$c192;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      peg$silentFails--;
      if (s3 === peg$FAILED) {
        s2 = void 0;
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c195) {
          s3 = peg$c195;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c196); }
        }
        if (s3 === peg$FAILED) {
          if (input.length > peg$currPos) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c198(s3);
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$currPos;
        s2 = peg$currPos;
        peg$silentFails++;
        if (input.charCodeAt(peg$currPos) === 34) {
          s3 = peg$c192;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c193); }
        }
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = void 0;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c195) {
            s3 = peg$c195;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c196); }
          }
          if (s3 === peg$FAILED) {
            if (input.length > peg$currPos) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c197); }
            }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c198(s3);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parsequotelessidentifier();
      if (s0 === peg$FAILED) {
        s0 = peg$parsestring();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c199); }
      }

      return s0;
    }

    function peg$parsequotelessidentifier() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      if (peg$c200.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c201); }
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          if (peg$c200.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c201); }
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c202(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsewhitespace() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (peg$c204.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c205); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c198(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c203); }
      }

      return s0;
    }

    function peg$parselineend() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (peg$c207.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c208); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c198(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c206); }
      }

      return s0;
    }

    function peg$parsemlcomstart() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c209) {
        s0 = peg$c209;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c210); }
      }

      return s0;
    }

    function peg$parsemlcomend() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c211) {
        s0 = peg$c211;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c212); }
      }

      return s0;
    }

    function peg$parsemlcomtok() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c211) {
        s2 = peg$c211;
        peg$currPos += 2;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c212); }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = void 0;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c198(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsemlcomment() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsemlcomstart();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsemlcomtok();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsemlcomtok();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsemlcomend();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c213(s1, s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseslcomstart() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c214) {
        s0 = peg$c214;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c215); }
      }
      if (s0 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 35) {
          s0 = peg$c216;
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c217); }
        }
      }

      return s0;
    }

    function peg$parseslcomtok() {
      var s0;

      if (peg$c218.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c219); }
      }

      return s0;
    }

    function peg$parseslcomment() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseslcomstart();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseslcomtok();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseslcomtok();
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c220(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsecomment() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parseslcomment();
      if (s0 === peg$FAILED) {
        s0 = peg$parsemlcomment();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c221); }
      }

      return s0;
    }

    function peg$parse_() {
      var s0, s1;

      s0 = [];
      s1 = peg$parsewhitespace();
      if (s1 === peg$FAILED) {
        s1 = peg$parselineend();
        if (s1 === peg$FAILED) {
          s1 = peg$parsecomment();
        }
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parsewhitespace();
        if (s1 === peg$FAILED) {
          s1 = peg$parselineend();
          if (s1 === peg$FAILED) {
            s1 = peg$parsecomment();
          }
        }
      }

      return s0;
    }

    function peg$parsenumberlike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsenumberlikestring();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c223(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parsenumber();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c224(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c222); }
      }

      return s0;
    }

    function peg$parsenumberlikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c192;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsenumber();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c192;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c193); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c225(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsenumber() {
      var s0;

      s0 = peg$parsereal();
      if (s0 === peg$FAILED) {
        s0 = peg$parsecardinal();
      }

      return s0;
    }

    function peg$parsecardinal() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      if (peg$c226.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c227); }
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          if (peg$c226.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c227); }
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c228(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsereal() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$parsecardinal();
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s3 = peg$c229;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c230); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsecardinal();
          if (s4 !== peg$FAILED) {
            s2 = [s2, s3, s4];
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c231(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebooleanlike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsebooleanlikestring();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c233(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseboolean();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c234(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c232); }
      }

      return s0;
    }

    function peg$parsebooleanlikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c192;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseboolean();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c192;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c193); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c223(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseboolean() {
      var s0;

      if (input.substr(peg$currPos, 4).toLowerCase() === peg$c235) {
        s0 = input.substr(peg$currPos, 4);
        peg$currPos += 4;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c236); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 5).toLowerCase() === peg$c237) {
          s0 = input.substr(peg$currPos, 5);
          peg$currPos += 5;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c238); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2).toLowerCase() === peg$c239) {
            s0 = input.substr(peg$currPos, 2);
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c240); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 3).toLowerCase() === peg$c241) {
              s0 = input.substr(peg$currPos, 3);
              peg$currPos += 3;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c242); }
            }
            if (s0 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 48) {
                s0 = peg$c243;
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c244); }
              }
              if (s0 === peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 49) {
                  s0 = peg$c245;
                  peg$currPos++;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c246); }
                }
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesizelike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parsesizelikestring();
      if (s0 === peg$FAILED) {
        s0 = peg$parsesize();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c247); }
      }

      return s0;
    }

    function peg$parsesizelikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c192;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesize();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c192;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c193); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c223(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesize() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsenumber();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c248(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c249) {
          s1 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c250); }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c251(s1);
        }
        s0 = s1;
      }

      return s0;
    }


        function merge(pBase, pObjectToMerge){
            pBase = pBase || {};
            if (pObjectToMerge){
                Object.getOwnPropertyNames(pObjectToMerge).forEach(function(pAttribute){
                    pBase[pAttribute] = pObjectToMerge[pAttribute];
                });
            }
            return pBase;
        }

        function optionArray2Object (pOptionList) {
            var lOptionList = {};
            pOptionList.forEach(function(lOption){
                lOptionList = merge(lOptionList, lOption);
            });
            return lOptionList;
        }

        function flattenBoolean(pBoolean) {
            return (["true", "on", "1"].indexOf(pBoolean.toLowerCase()) > -1);
        }

        function nameValue2Option(pName, pValue){
            var lOption = {};
            lOption[pName.toLowerCase()] = pValue;
            return lOption;
        }

        function entityExists (pEntities, pName) {
            return pName === undefined || pName === "*" || pEntities.some(function(pEntity){
                return pEntity.name === pName;
            });
        }

        function isMscGenKeyword(pString){
            return [
                "box", "abox", "rbox", "note", "msc", "hscale", "width",
                "arcgradient", "wordwraparcs", "label", "color", "idurl", "id",
                "url", "linecolor", "linecolour", "textcolor", "textcolour",
               "textbgcolor", "textbgcolour", "arclinecolor", "arclinecolour",
               "arctextcolor", "arctextcolour","arctextbgcolor", "arctextbgcolour",
               "arcskip"
            ].indexOf(pString) > -1;
        }

        function buildEntityNotDefinedMessage(pEntityName, pArc){
            return "Entity '" + pEntityName + "' in arc " +
                   "'" + pArc.from + " " + pArc.kind + " " + pArc.to + "' " +
                   "is not defined.";
        }

        function EntityNotDefinedError (pEntityName, pArc) {
            this.name = "EntityNotDefinedError";
            this.message = buildEntityNotDefinedMessage(pEntityName, pArc);
            /* istanbul ignore else  */
            if(!!pArc.location){
                this.location = pArc.location;
                this.location.start.line++;
                this.location.end.line++;
            }
        }

        function checkForUndeclaredEntities (pEntities, pArcLines) {
            if (!pEntities) {
                pEntities = [];
            }
            if (pArcLines) {
                pArcLines.forEach(function(pArcLine) {
                    pArcLine.forEach(function(pArc) {
                        if (pArc.from && !entityExists (pEntities, pArc.from)) {
                            throw new EntityNotDefinedError(pArc.from, pArc);
                        }
                        if (pArc.to && !entityExists (pEntities, pArc.to)) {
                            throw new EntityNotDefinedError(pArc.to, pArc);
                        }
                        if (!!pArc.location) {
                            delete pArc.location;
                        }
                        if (!!pArc.arcs){
                            checkForUndeclaredEntities(pEntities, pArc.arcs);
                        }
                    });
                });
            }
            return pEntities;
        }

        function hasExtendedOptions (pOptions){
            if (pOptions){
                return (
                         pOptions.hasOwnProperty("watermark")
                      || pOptions.hasOwnProperty("wordwrapentities")
                      || pOptions.hasOwnProperty("wordwrapboxes")
                      || ( pOptions.hasOwnProperty("width") && pOptions.width === "auto")
                );
            } else {
                return false;
            }
        }

        function hasExtendedArcTypes(pArcLines){
            if (pArcLines){
                return pArcLines.some(function(pArcLine){
                    return pArcLine.some(function(pArc){
                        return (["alt", "else", "opt", "break", "par",
                          "seq", "strict", "neg", "critical",
                          "ignore", "consider", "assert",
                          "loop", "ref", "exc"].indexOf(pArc.kind) > -1);
                    });
                });
            }
            return false;
        }

        function getMetaInfo(pOptions, pArcLineList){
            var lHasExtendedOptions  = hasExtendedOptions(pOptions);
            var lHasExtendedArcTypes = hasExtendedArcTypes(pArcLineList);
            return {
                "extendedOptions" : lHasExtendedOptions,
                "extendedArcTypes": lHasExtendedArcTypes,
                "extendedFeatures": lHasExtendedOptions||lHasExtendedArcTypes
            }
        }


    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail(peg$endExpectation());
      }

      throw peg$buildStructuredError(
        peg$maxFailExpected,
        peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
        peg$maxFailPos < input.length
          ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
          : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
      );
    }
  }

  return {
    SyntaxError: peg$SyntaxError,
    parse:       peg$parse
  };
});

/*
 * Generated by PEG.js 0.10.0.
 *
 * http://pegjs.org/
 */
(function(root, factory) {
  if (typeof define === "function" && define.amd) {
    define('lib/mscgenjs-core/parse/msgennyparser',[], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  }
})(this, function() {
  "use strict";

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function peg$SyntaxError(message, expected, found, location) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.location = location;
    this.name     = "SyntaxError";

    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, peg$SyntaxError);
    }
  }

  peg$subclass(peg$SyntaxError, Error);

  peg$SyntaxError.buildMessage = function(expected, found) {
    var DESCRIBE_EXPECTATION_FNS = {
          literal: function(expectation) {
            return "\"" + literalEscape(expectation.text) + "\"";
          },

          "class": function(expectation) {
            var escapedParts = "",
                i;

            for (i = 0; i < expectation.parts.length; i++) {
              escapedParts += expectation.parts[i] instanceof Array
                ? classEscape(expectation.parts[i][0]) + "-" + classEscape(expectation.parts[i][1])
                : classEscape(expectation.parts[i]);
            }

            return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
          },

          any: function(expectation) {
            return "any character";
          },

          end: function(expectation) {
            return "end of input";
          },

          other: function(expectation) {
            return expectation.description;
          }
        };

    function hex(ch) {
      return ch.charCodeAt(0).toString(16).toUpperCase();
    }

    function literalEscape(s) {
      return s
        .replace(/\\/g, '\\\\')
        .replace(/"/g,  '\\"')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
        .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
    }

    function classEscape(s) {
      return s
        .replace(/\\/g, '\\\\')
        .replace(/\]/g, '\\]')
        .replace(/\^/g, '\\^')
        .replace(/-/g,  '\\-')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
        .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
    }

    function describeExpectation(expectation) {
      return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
    }

    function describeExpected(expected) {
      var descriptions = new Array(expected.length),
          i, j;

      for (i = 0; i < expected.length; i++) {
        descriptions[i] = describeExpectation(expected[i]);
      }

      descriptions.sort();

      if (descriptions.length > 0) {
        for (i = 1, j = 1; i < descriptions.length; i++) {
          if (descriptions[i - 1] !== descriptions[i]) {
            descriptions[j] = descriptions[i];
            j++;
          }
        }
        descriptions.length = j;
      }

      switch (descriptions.length) {
        case 1:
          return descriptions[0];

        case 2:
          return descriptions[0] + " or " + descriptions[1];

        default:
          return descriptions.slice(0, -1).join(", ")
            + ", or "
            + descriptions[descriptions.length - 1];
      }
    }

    function describeFound(found) {
      return found ? "\"" + literalEscape(found) + "\"" : "end of input";
    }

    return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
  };

  function peg$parse(input, options) {
    options = options !== void 0 ? options : {};

    var peg$FAILED = {},

        peg$startRuleFunctions = { program: peg$parseprogram },
        peg$startRuleFunction  = peg$parseprogram,

        peg$c0 = function(pre, d) {
                d.entities = extractUndeclaredEntities(d.entities, d.arcs);
                var lRetval = d

                lRetval = merge ({meta: getMetaInfo(d.options, d.arcs)}, lRetval);

                if (pre.length > 0) {
                    lRetval = merge({precomment: pre}, lRetval);
                }
                return lRetval;
            },
        peg$c1 = function(options, entities, arcs) {
                  var lDeclarationList = {};
                  if (options) {
                      lDeclarationList.options = options;
                  }
                  if (entities) {
                      lDeclarationList.entities = entities;
                  }
                  if (arcs) {
                      lDeclarationList.arcs = arcs;
                  }
                  return lDeclarationList;
              },
        peg$c2 = ",",
        peg$c3 = peg$literalExpectation(",", false),
        peg$c4 = function(o) {return o},
        peg$c5 = ";",
        peg$c6 = peg$literalExpectation(";", false),
        peg$c7 = function(options) {
              return optionArray2Object(options[0].concat(options[1]));
            },
        peg$c8 = "hscale",
        peg$c9 = peg$literalExpectation("hscale", true),
        peg$c10 = "arcgradient",
        peg$c11 = peg$literalExpectation("arcgradient", true),
        peg$c12 = "=",
        peg$c13 = peg$literalExpectation("=", false),
        peg$c14 = function(name, value) {
                    return nameValue2Option(name, value);
                },
        peg$c15 = "width",
        peg$c16 = peg$literalExpectation("width", true),
        peg$c17 = "wordwraparcs",
        peg$c18 = peg$literalExpectation("wordwraparcs", true),
        peg$c19 = function(name, value) {
                    return nameValue2Option(name, flattenBoolean(value));
                },
        peg$c20 = "wordwrapentities",
        peg$c21 = peg$literalExpectation("wordwrapentities", true),
        peg$c22 = "wordwrapboxes",
        peg$c23 = peg$literalExpectation("wordwrapboxes", true),
        peg$c24 = "watermark",
        peg$c25 = peg$literalExpectation("watermark", true),
        peg$c26 = function(e) {return e},
        peg$c27 = function(el) {
              return el[0].concat(el[1]);
            },
        peg$c28 = peg$otherExpectation("entity"),
        peg$c29 = ":",
        peg$c30 = peg$literalExpectation(":", false),
        peg$c31 = function(name, l) {return l},
        peg$c32 = function(name, label) {
              var lEntity = {};
              lEntity.name = name;
              if (!!label) {
                lEntity.label = label;
              }
              return lEntity;
            },
        peg$c33 = function(a) {return a},
        peg$c34 = function(al) {
               return al[0].concat(al[1]);
            },
        peg$c35 = function(sa) {return sa},
        peg$c36 = function(da) {return da},
        peg$c37 = function(ca) {return ca},
        peg$c38 = function(ra, s) {return s},
        peg$c39 = function(ra, label) {
              if (label) {
                ra.label = label;
              }
              return ra;
            },
        peg$c40 = function(kind) {return {kind:kind}},
        peg$c41 = function(from, kind, to) {return {kind: kind, from:from, to:to}},
        peg$c42 = "*",
        peg$c43 = peg$literalExpectation("*", false),
        peg$c44 = function(kind, to) {return {kind:kind, from: "*", to:to}},
        peg$c45 = function(from, kind) {return {kind:kind, from: from, to: "*"}},
        peg$c46 = function(from, kind, to, s) {return s},
        peg$c47 = "{",
        peg$c48 = peg$literalExpectation("{", false),
        peg$c49 = "}",
        peg$c50 = peg$literalExpectation("}", false),
        peg$c51 = function(from, kind, to, label, arcs) {
                var retval = {
                    kind : kind,
                    from : from,
                    to   : to,
                    arcs : arcs
                };
                if (label) {
                  retval.label = label;
                }
                return retval;
              },
        peg$c52 = peg$otherExpectation("empty row"),
        peg$c53 = "|||",
        peg$c54 = peg$literalExpectation("|||", false),
        peg$c55 = "...",
        peg$c56 = peg$literalExpectation("...", false),
        peg$c57 = peg$otherExpectation("---"),
        peg$c58 = "---",
        peg$c59 = peg$literalExpectation("---", false),
        peg$c60 = function(kind) {
                return kind.toLowerCase();
            },
        peg$c61 = peg$otherExpectation("bi-directional arrow"),
        peg$c62 = "--",
        peg$c63 = peg$literalExpectation("--", false),
        peg$c64 = "<->",
        peg$c65 = peg$literalExpectation("<->", false),
        peg$c66 = "==",
        peg$c67 = peg$literalExpectation("==", false),
        peg$c68 = "<<=>>",
        peg$c69 = peg$literalExpectation("<<=>>", false),
        peg$c70 = "<=>",
        peg$c71 = peg$literalExpectation("<=>", false),
        peg$c72 = "..",
        peg$c73 = peg$literalExpectation("..", false),
        peg$c74 = "<<>>",
        peg$c75 = peg$literalExpectation("<<>>", false),
        peg$c76 = "::",
        peg$c77 = peg$literalExpectation("::", false),
        peg$c78 = "<:>",
        peg$c79 = peg$literalExpectation("<:>", false),
        peg$c80 = peg$otherExpectation("left to right arrow"),
        peg$c81 = "->",
        peg$c82 = peg$literalExpectation("->", false),
        peg$c83 = "=>>",
        peg$c84 = peg$literalExpectation("=>>", false),
        peg$c85 = "=>",
        peg$c86 = peg$literalExpectation("=>", false),
        peg$c87 = ">>",
        peg$c88 = peg$literalExpectation(">>", false),
        peg$c89 = ":>",
        peg$c90 = peg$literalExpectation(":>", false),
        peg$c91 = "-x",
        peg$c92 = peg$literalExpectation("-x", true),
        peg$c93 = peg$otherExpectation("right to left arrow"),
        peg$c94 = "<-",
        peg$c95 = peg$literalExpectation("<-", false),
        peg$c96 = "<<=",
        peg$c97 = peg$literalExpectation("<<=", false),
        peg$c98 = "<=",
        peg$c99 = peg$literalExpectation("<=", false),
        peg$c100 = "<<",
        peg$c101 = peg$literalExpectation("<<", false),
        peg$c102 = "<:",
        peg$c103 = peg$literalExpectation("<:", false),
        peg$c104 = "x-",
        peg$c105 = peg$literalExpectation("x-", true),
        peg$c106 = peg$otherExpectation("box"),
        peg$c107 = "note",
        peg$c108 = peg$literalExpectation("note", true),
        peg$c109 = "abox",
        peg$c110 = peg$literalExpectation("abox", true),
        peg$c111 = "rbox",
        peg$c112 = peg$literalExpectation("rbox", true),
        peg$c113 = "box",
        peg$c114 = peg$literalExpectation("box", true),
        peg$c115 = peg$otherExpectation("inline expression"),
        peg$c116 = "alt",
        peg$c117 = peg$literalExpectation("alt", true),
        peg$c118 = "else",
        peg$c119 = peg$literalExpectation("else", true),
        peg$c120 = "opt",
        peg$c121 = peg$literalExpectation("opt", true),
        peg$c122 = "break",
        peg$c123 = peg$literalExpectation("break", true),
        peg$c124 = "par",
        peg$c125 = peg$literalExpectation("par", true),
        peg$c126 = "seq",
        peg$c127 = peg$literalExpectation("seq", true),
        peg$c128 = "strict",
        peg$c129 = peg$literalExpectation("strict", true),
        peg$c130 = "neg",
        peg$c131 = peg$literalExpectation("neg", true),
        peg$c132 = "critical",
        peg$c133 = peg$literalExpectation("critical", true),
        peg$c134 = "ignore",
        peg$c135 = peg$literalExpectation("ignore", true),
        peg$c136 = "consider",
        peg$c137 = peg$literalExpectation("consider", true),
        peg$c138 = "assert",
        peg$c139 = peg$literalExpectation("assert", true),
        peg$c140 = "loop",
        peg$c141 = peg$literalExpectation("loop", true),
        peg$c142 = "ref",
        peg$c143 = peg$literalExpectation("ref", true),
        peg$c144 = "exc",
        peg$c145 = peg$literalExpectation("exc", true),
        peg$c146 = function(kind) {
                return kind.toLowerCase()
            },
        peg$c147 = peg$otherExpectation("double quoted string"),
        peg$c148 = "\"",
        peg$c149 = peg$literalExpectation("\"", false),
        peg$c150 = function(s) {return s.join("")},
        peg$c151 = "\\\"",
        peg$c152 = peg$literalExpectation("\\\"", false),
        peg$c153 = peg$anyExpectation(),
        peg$c154 = function(c) {return c},
        peg$c155 = function(s) {return s.join("").trim()},
        peg$c156 = peg$otherExpectation("identifier"),
        peg$c157 = /^[^;, "\t\n\r=\-><:{*]/,
        peg$c158 = peg$classExpectation([";", ",", " ", "\"", "\t", "\n", "\r", "=", "-", ">", "<", ":", "{", "*"], true, false),
        peg$c159 = function(letters) {return letters.join("")},
        peg$c160 = peg$otherExpectation("whitespace"),
        peg$c161 = /^[ \t]/,
        peg$c162 = peg$classExpectation([" ", "\t"], false, false),
        peg$c163 = peg$otherExpectation("lineend"),
        peg$c164 = /^[\r\n]/,
        peg$c165 = peg$classExpectation(["\r", "\n"], false, false),
        peg$c166 = "/*",
        peg$c167 = peg$literalExpectation("/*", false),
        peg$c168 = "*/",
        peg$c169 = peg$literalExpectation("*/", false),
        peg$c170 = function(start, com, end) {
              return start + com.join("") + end
            },
        peg$c171 = "//",
        peg$c172 = peg$literalExpectation("//", false),
        peg$c173 = "#",
        peg$c174 = peg$literalExpectation("#", false),
        peg$c175 = /^[^\r\n]/,
        peg$c176 = peg$classExpectation(["\r", "\n"], true, false),
        peg$c177 = function(start, com) {
              return start + com.join("")
            },
        peg$c178 = peg$otherExpectation("comment"),
        peg$c179 = peg$otherExpectation("number"),
        peg$c180 = function(s) { return s; },
        peg$c181 = function(i) { return i.toString(); },
        peg$c182 = function(s) { return s.toString(); },
        peg$c183 = /^[0-9]/,
        peg$c184 = peg$classExpectation([["0", "9"]], false, false),
        peg$c185 = function(digits) { return parseInt(digits.join(""), 10); },
        peg$c186 = ".",
        peg$c187 = peg$literalExpectation(".", false),
        peg$c188 = function(digits) { return parseFloat(digits.join("")); },
        peg$c189 = peg$otherExpectation("boolean"),
        peg$c190 = function(bs) {return bs;},
        peg$c191 = function(b) {return b.toString();},
        peg$c192 = "true",
        peg$c193 = peg$literalExpectation("true", true),
        peg$c194 = "false",
        peg$c195 = peg$literalExpectation("false", true),
        peg$c196 = "on",
        peg$c197 = peg$literalExpectation("on", true),
        peg$c198 = "off",
        peg$c199 = peg$literalExpectation("off", true),
        peg$c200 = "0",
        peg$c201 = peg$literalExpectation("0", false),
        peg$c202 = "1",
        peg$c203 = peg$literalExpectation("1", false),
        peg$c204 = peg$otherExpectation("size"),
        peg$c205 = function(n) {return n.toString(); },
        peg$c206 = "auto",
        peg$c207 = peg$literalExpectation("auto", true),
        peg$c208 = function(s) {return s.toLowerCase(); },

        peg$currPos          = 0,
        peg$savedPos         = 0,
        peg$posDetailsCache  = [{ line: 1, column: 1 }],
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$savedPos, peg$currPos);
    }

    function location() {
      return peg$computeLocation(peg$savedPos, peg$currPos);
    }

    function expected(description, location) {
      location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

      throw peg$buildStructuredError(
        [peg$otherExpectation(description)],
        input.substring(peg$savedPos, peg$currPos),
        location
      );
    }

    function error(message, location) {
      location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

      throw peg$buildSimpleError(message, location);
    }

    function peg$literalExpectation(text, ignoreCase) {
      return { type: "literal", text: text, ignoreCase: ignoreCase };
    }

    function peg$classExpectation(parts, inverted, ignoreCase) {
      return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
    }

    function peg$anyExpectation() {
      return { type: "any" };
    }

    function peg$endExpectation() {
      return { type: "end" };
    }

    function peg$otherExpectation(description) {
      return { type: "other", description: description };
    }

    function peg$computePosDetails(pos) {
      var details = peg$posDetailsCache[pos], p;

      if (details) {
        return details;
      } else {
        p = pos - 1;
        while (!peg$posDetailsCache[p]) {
          p--;
        }

        details = peg$posDetailsCache[p];
        details = {
          line:   details.line,
          column: details.column
        };

        while (p < pos) {
          if (input.charCodeAt(p) === 10) {
            details.line++;
            details.column = 1;
          } else {
            details.column++;
          }

          p++;
        }

        peg$posDetailsCache[pos] = details;
        return details;
      }
    }

    function peg$computeLocation(startPos, endPos) {
      var startPosDetails = peg$computePosDetails(startPos),
          endPosDetails   = peg$computePosDetails(endPos);

      return {
        start: {
          offset: startPos,
          line:   startPosDetails.line,
          column: startPosDetails.column
        },
        end: {
          offset: endPos,
          line:   endPosDetails.line,
          column: endPosDetails.column
        }
      };
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildSimpleError(message, location) {
      return new peg$SyntaxError(message, null, null, location);
    }

    function peg$buildStructuredError(expected, found, location) {
      return new peg$SyntaxError(
        peg$SyntaxError.buildMessage(expected, found),
        expected,
        found,
        location
      );
    }

    function peg$parseprogram() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsedeclarationlist();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c0(s1, s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsedeclarationlist() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseoptionlist();
      if (s1 === peg$FAILED) {
        s1 = null;
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseentitylist();
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsearclist();
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c1(s1, s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseoptionlist() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseoption();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c2;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c3); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c4(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseoption();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c2;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c3); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c4(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseoption();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s5 = peg$c5;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c4(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c7(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseoption() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6).toLowerCase() === peg$c8) {
          s2 = input.substr(peg$currPos, 6);
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c9); }
        }
        if (s2 === peg$FAILED) {
          if (input.substr(peg$currPos, 11).toLowerCase() === peg$c10) {
            s2 = input.substr(peg$currPos, 11);
            peg$currPos += 11;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c11); }
          }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 61) {
              s4 = peg$c12;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c13); }
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parsenumberlike();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c14(s2, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.substr(peg$currPos, 5).toLowerCase() === peg$c15) {
            s2 = input.substr(peg$currPos, 5);
            peg$currPos += 5;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c16); }
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 61) {
                s4 = peg$c12;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c13); }
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parse_();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parsesizelike();
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parse_();
                    if (s7 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c14(s2, s6);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parse_();
          if (s1 !== peg$FAILED) {
            if (input.substr(peg$currPos, 12).toLowerCase() === peg$c17) {
              s2 = input.substr(peg$currPos, 12);
              peg$currPos += 12;
            } else {
              s2 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c18); }
            }
            if (s2 !== peg$FAILED) {
              s3 = peg$parse_();
              if (s3 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 61) {
                  s4 = peg$c12;
                  peg$currPos++;
                } else {
                  s4 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c13); }
                }
                if (s4 !== peg$FAILED) {
                  s5 = peg$parse_();
                  if (s5 !== peg$FAILED) {
                    s6 = peg$parsebooleanlike();
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parse_();
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c19(s2, s6);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parse_();
            if (s1 !== peg$FAILED) {
              if (input.substr(peg$currPos, 16).toLowerCase() === peg$c20) {
                s2 = input.substr(peg$currPos, 16);
                peg$currPos += 16;
              } else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c21); }
              }
              if (s2 !== peg$FAILED) {
                s3 = peg$parse_();
                if (s3 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 61) {
                    s4 = peg$c12;
                    peg$currPos++;
                  } else {
                    s4 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c13); }
                  }
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parse_();
                    if (s5 !== peg$FAILED) {
                      s6 = peg$parsebooleanlike();
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parse_();
                        if (s7 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c19(s2, s6);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parse_();
              if (s1 !== peg$FAILED) {
                if (input.substr(peg$currPos, 13).toLowerCase() === peg$c22) {
                  s2 = input.substr(peg$currPos, 13);
                  peg$currPos += 13;
                } else {
                  s2 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c23); }
                }
                if (s2 !== peg$FAILED) {
                  s3 = peg$parse_();
                  if (s3 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 61) {
                      s4 = peg$c12;
                      peg$currPos++;
                    } else {
                      s4 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c13); }
                    }
                    if (s4 !== peg$FAILED) {
                      s5 = peg$parse_();
                      if (s5 !== peg$FAILED) {
                        s6 = peg$parsebooleanlike();
                        if (s6 !== peg$FAILED) {
                          s7 = peg$parse_();
                          if (s7 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c19(s2, s6);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                s1 = peg$parse_();
                if (s1 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 9).toLowerCase() === peg$c24) {
                    s2 = input.substr(peg$currPos, 9);
                    peg$currPos += 9;
                  } else {
                    s2 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c25); }
                  }
                  if (s2 !== peg$FAILED) {
                    s3 = peg$parse_();
                    if (s3 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 61) {
                        s4 = peg$c12;
                        peg$currPos++;
                      } else {
                        s4 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c13); }
                      }
                      if (s4 !== peg$FAILED) {
                        s5 = peg$parse_();
                        if (s5 !== peg$FAILED) {
                          s6 = peg$parsequotedstring();
                          if (s6 !== peg$FAILED) {
                            s7 = peg$parse_();
                            if (s7 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c14(s2, s6);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parseentitylist() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseentity();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c2;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c3); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c26(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseentity();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c2;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c3); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c26(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseentity();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s5 = peg$c5;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c26(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c27(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parseentity() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$currPos;
            if (input.charCodeAt(peg$currPos) === 58) {
              s5 = peg$c29;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c30); }
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                s7 = peg$parsestring();
                if (s7 !== peg$FAILED) {
                  s8 = peg$parse_();
                  if (s8 !== peg$FAILED) {
                    peg$savedPos = s4;
                    s5 = peg$c31(s2, s7);
                    s4 = s5;
                  } else {
                    peg$currPos = s4;
                    s4 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
            if (s4 === peg$FAILED) {
              s4 = null;
            }
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c32(s2, s4);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }

      return s0;
    }

    function peg$parsearclist() {
      var s0, s1, s2, s3, s4;

      s0 = [];
      s1 = peg$currPos;
      s2 = peg$parsearcline();
      if (s2 !== peg$FAILED) {
        s3 = peg$parse_();
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s4 = peg$c5;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c33(s2);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        while (s1 !== peg$FAILED) {
          s0.push(s1);
          s1 = peg$currPos;
          s2 = peg$parsearcline();
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 59) {
                s4 = peg$c5;
                peg$currPos++;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c6); }
              }
              if (s4 !== peg$FAILED) {
                peg$savedPos = s1;
                s2 = peg$c33(s2);
                s1 = s2;
              } else {
                peg$currPos = s1;
                s1 = peg$FAILED;
              }
            } else {
              peg$currPos = s1;
              s1 = peg$FAILED;
            }
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        }
      } else {
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsearcline() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parsearc();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c2;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c3); }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c33(s4);
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parsearc();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c2;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c3); }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s4 = peg$c33(s4);
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parsearc();
        if (s4 !== peg$FAILED) {
          peg$savedPos = s3;
          s4 = peg$c33(s4);
        }
        s3 = s4;
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c34(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsearc() {
      var s0;

      s0 = peg$parseregulararc();
      if (s0 === peg$FAILED) {
        s0 = peg$parsespanarc();
      }

      return s0;
    }

    function peg$parseregulararc() {
      var s0, s1, s2, s3, s4, s5, s6;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$parsesinglearc();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s1;
        s2 = peg$c35(s2);
      }
      s1 = s2;
      if (s1 === peg$FAILED) {
        s1 = peg$currPos;
        s2 = peg$parsedualarc();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c36(s2);
        }
        s1 = s2;
        if (s1 === peg$FAILED) {
          s1 = peg$currPos;
          s2 = peg$parsecommentarc();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c37(s2);
          }
          s1 = s2;
        }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 58) {
          s3 = peg$c29;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c30); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parse_();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsestring();
            if (s5 !== peg$FAILED) {
              s6 = peg$parse_();
              if (s6 !== peg$FAILED) {
                peg$savedPos = s2;
                s3 = peg$c38(s1, s5);
                s2 = s3;
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c39(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesinglearc() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesinglearctoken();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c40(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsecommentarc() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecommenttoken();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c40(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsedualarc() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsedualarctoken();
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c41(s2, s4, s6);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parse_();
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 42) {
            s2 = peg$c42;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c43); }
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parse_();
            if (s3 !== peg$FAILED) {
              s4 = peg$parsebckarrowtoken();
              if (s4 !== peg$FAILED) {
                s5 = peg$parse_();
                if (s5 !== peg$FAILED) {
                  s6 = peg$parseidentifier();
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parse_();
                    if (s7 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c44(s4, s6);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parse_();
          if (s1 !== peg$FAILED) {
            s2 = peg$parseidentifier();
            if (s2 !== peg$FAILED) {
              s3 = peg$parse_();
              if (s3 !== peg$FAILED) {
                s4 = peg$parsefwdarrowtoken();
                if (s4 !== peg$FAILED) {
                  s5 = peg$parse_();
                  if (s5 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 42) {
                      s6 = peg$c42;
                      peg$currPos++;
                    } else {
                      s6 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c43); }
                    }
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parse_();
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c45(s2, s4);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parse_();
            if (s1 !== peg$FAILED) {
              s2 = peg$parseidentifier();
              if (s2 !== peg$FAILED) {
                s3 = peg$parse_();
                if (s3 !== peg$FAILED) {
                  s4 = peg$parsebidiarrowtoken();
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parse_();
                    if (s5 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 42) {
                        s6 = peg$c42;
                        peg$currPos++;
                      } else {
                        s6 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c43); }
                      }
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parse_();
                        if (s7 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c45(s2, s4);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          }
        }
      }

      return s0;
    }

    function peg$parsespanarc() {
      var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14;

      s0 = peg$currPos;
      s1 = peg$parse_();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseidentifier();
        if (s2 !== peg$FAILED) {
          s3 = peg$parse_();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsespanarctoken();
            if (s4 !== peg$FAILED) {
              s5 = peg$parse_();
              if (s5 !== peg$FAILED) {
                s6 = peg$parseidentifier();
                if (s6 !== peg$FAILED) {
                  s7 = peg$parse_();
                  if (s7 !== peg$FAILED) {
                    s8 = peg$currPos;
                    if (input.charCodeAt(peg$currPos) === 58) {
                      s9 = peg$c29;
                      peg$currPos++;
                    } else {
                      s9 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c30); }
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parse_();
                      if (s10 !== peg$FAILED) {
                        s11 = peg$parsestring();
                        if (s11 !== peg$FAILED) {
                          s12 = peg$parse_();
                          if (s12 !== peg$FAILED) {
                            peg$savedPos = s8;
                            s9 = peg$c46(s2, s4, s6, s11);
                            s8 = s9;
                          } else {
                            peg$currPos = s8;
                            s8 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s8;
                          s8 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s8;
                        s8 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                    if (s8 === peg$FAILED) {
                      s8 = null;
                    }
                    if (s8 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 123) {
                        s9 = peg$c47;
                        peg$currPos++;
                      } else {
                        s9 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c48); }
                      }
                      if (s9 !== peg$FAILED) {
                        s10 = peg$parse_();
                        if (s10 !== peg$FAILED) {
                          s11 = peg$parsearclist();
                          if (s11 === peg$FAILED) {
                            s11 = null;
                          }
                          if (s11 !== peg$FAILED) {
                            s12 = peg$parse_();
                            if (s12 !== peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 125) {
                                s13 = peg$c49;
                                peg$currPos++;
                              } else {
                                s13 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c50); }
                              }
                              if (s13 !== peg$FAILED) {
                                s14 = peg$parse_();
                                if (s14 !== peg$FAILED) {
                                  peg$savedPos = s0;
                                  s1 = peg$c51(s2, s4, s6, s8, s11);
                                  s0 = s1;
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesinglearctoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 3) === peg$c53) {
        s0 = peg$c53;
        peg$currPos += 3;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c54); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c55) {
          s0 = peg$c55;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c56); }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c52); }
      }

      return s0;
    }

    function peg$parsecommenttoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 3) === peg$c58) {
        s0 = peg$c58;
        peg$currPos += 3;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c59); }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c57); }
      }

      return s0;
    }

    function peg$parsedualarctoken() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsebidiarrowtoken();
      if (s1 === peg$FAILED) {
        s1 = peg$parsefwdarrowtoken();
        if (s1 === peg$FAILED) {
          s1 = peg$parsebckarrowtoken();
          if (s1 === peg$FAILED) {
            s1 = peg$parseboxtoken();
          }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c60(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebidiarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c62) {
        s0 = peg$c62;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c63); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c64) {
          s0 = peg$c64;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c65); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c66) {
            s0 = peg$c66;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c67); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 5) === peg$c68) {
              s0 = peg$c68;
              peg$currPos += 5;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c69); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 3) === peg$c70) {
                s0 = peg$c70;
                peg$currPos += 3;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c71); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c72) {
                  s0 = peg$c72;
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c73); }
                }
                if (s0 === peg$FAILED) {
                  if (input.substr(peg$currPos, 4) === peg$c74) {
                    s0 = peg$c74;
                    peg$currPos += 4;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c75); }
                  }
                  if (s0 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c76) {
                      s0 = peg$c76;
                      peg$currPos += 2;
                    } else {
                      s0 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c77); }
                    }
                    if (s0 === peg$FAILED) {
                      if (input.substr(peg$currPos, 3) === peg$c78) {
                        s0 = peg$c78;
                        peg$currPos += 3;
                      } else {
                        s0 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c79); }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c61); }
      }

      return s0;
    }

    function peg$parsefwdarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c81) {
        s0 = peg$c81;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c82); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c83) {
          s0 = peg$c83;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c84); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c85) {
            s0 = peg$c85;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c86); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c87) {
              s0 = peg$c87;
              peg$currPos += 2;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c88); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 2) === peg$c89) {
                s0 = peg$c89;
                peg$currPos += 2;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c90); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2).toLowerCase() === peg$c91) {
                  s0 = input.substr(peg$currPos, 2);
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c92); }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c80); }
      }

      return s0;
    }

    function peg$parsebckarrowtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c94) {
        s0 = peg$c94;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c95); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c96) {
          s0 = peg$c96;
          peg$currPos += 3;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c98) {
            s0 = peg$c98;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c99); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c100) {
              s0 = peg$c100;
              peg$currPos += 2;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c101); }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 2) === peg$c102) {
                s0 = peg$c102;
                peg$currPos += 2;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c103); }
              }
              if (s0 === peg$FAILED) {
                if (input.substr(peg$currPos, 2).toLowerCase() === peg$c104) {
                  s0 = input.substr(peg$currPos, 2);
                  peg$currPos += 2;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c105); }
                }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c93); }
      }

      return s0;
    }

    function peg$parseboxtoken() {
      var s0, s1;

      peg$silentFails++;
      if (input.substr(peg$currPos, 4).toLowerCase() === peg$c107) {
        s0 = input.substr(peg$currPos, 4);
        peg$currPos += 4;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c108); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c109) {
          s0 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c110); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 4).toLowerCase() === peg$c111) {
            s0 = input.substr(peg$currPos, 4);
            peg$currPos += 4;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c112); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 3).toLowerCase() === peg$c113) {
              s0 = input.substr(peg$currPos, 3);
              peg$currPos += 3;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c114); }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c106); }
      }

      return s0;
    }

    function peg$parsespanarctoken() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 3).toLowerCase() === peg$c116) {
        s1 = input.substr(peg$currPos, 3);
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c117); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c118) {
          s1 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c119); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 3).toLowerCase() === peg$c120) {
            s1 = input.substr(peg$currPos, 3);
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c121); }
          }
          if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 5).toLowerCase() === peg$c122) {
              s1 = input.substr(peg$currPos, 5);
              peg$currPos += 5;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s1 === peg$FAILED) {
              if (input.substr(peg$currPos, 3).toLowerCase() === peg$c124) {
                s1 = input.substr(peg$currPos, 3);
                peg$currPos += 3;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c125); }
              }
              if (s1 === peg$FAILED) {
                if (input.substr(peg$currPos, 3).toLowerCase() === peg$c126) {
                  s1 = input.substr(peg$currPos, 3);
                  peg$currPos += 3;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c127); }
                }
                if (s1 === peg$FAILED) {
                  if (input.substr(peg$currPos, 6).toLowerCase() === peg$c128) {
                    s1 = input.substr(peg$currPos, 6);
                    peg$currPos += 6;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c129); }
                  }
                  if (s1 === peg$FAILED) {
                    if (input.substr(peg$currPos, 3).toLowerCase() === peg$c130) {
                      s1 = input.substr(peg$currPos, 3);
                      peg$currPos += 3;
                    } else {
                      s1 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c131); }
                    }
                    if (s1 === peg$FAILED) {
                      if (input.substr(peg$currPos, 8).toLowerCase() === peg$c132) {
                        s1 = input.substr(peg$currPos, 8);
                        peg$currPos += 8;
                      } else {
                        s1 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c133); }
                      }
                      if (s1 === peg$FAILED) {
                        if (input.substr(peg$currPos, 6).toLowerCase() === peg$c134) {
                          s1 = input.substr(peg$currPos, 6);
                          peg$currPos += 6;
                        } else {
                          s1 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c135); }
                        }
                        if (s1 === peg$FAILED) {
                          if (input.substr(peg$currPos, 8).toLowerCase() === peg$c136) {
                            s1 = input.substr(peg$currPos, 8);
                            peg$currPos += 8;
                          } else {
                            s1 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c137); }
                          }
                          if (s1 === peg$FAILED) {
                            if (input.substr(peg$currPos, 6).toLowerCase() === peg$c138) {
                              s1 = input.substr(peg$currPos, 6);
                              peg$currPos += 6;
                            } else {
                              s1 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c139); }
                            }
                            if (s1 === peg$FAILED) {
                              if (input.substr(peg$currPos, 4).toLowerCase() === peg$c140) {
                                s1 = input.substr(peg$currPos, 4);
                                peg$currPos += 4;
                              } else {
                                s1 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c141); }
                              }
                              if (s1 === peg$FAILED) {
                                if (input.substr(peg$currPos, 3).toLowerCase() === peg$c142) {
                                  s1 = input.substr(peg$currPos, 3);
                                  peg$currPos += 3;
                                } else {
                                  s1 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c143); }
                                }
                                if (s1 === peg$FAILED) {
                                  if (input.substr(peg$currPos, 3).toLowerCase() === peg$c144) {
                                    s1 = input.substr(peg$currPos, 3);
                                    peg$currPos += 3;
                                  } else {
                                    s1 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c145); }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c146(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c115); }
      }

      return s0;
    }

    function peg$parsestring() {
      var s0;

      s0 = peg$parsequotedstring();
      if (s0 === peg$FAILED) {
        s0 = peg$parseunquotedstring();
      }

      return s0;
    }

    function peg$parsequotedstring() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c148;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c149); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsestringcontent();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c148;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c149); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c150(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c147); }
      }

      return s0;
    }

    function peg$parsestringcontent() {
      var s0, s1, s2, s3;

      s0 = [];
      s1 = peg$currPos;
      s2 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 34) {
        s3 = peg$c148;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c149); }
      }
      peg$silentFails--;
      if (s3 === peg$FAILED) {
        s2 = void 0;
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c151) {
          s3 = peg$c151;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c152); }
        }
        if (s3 === peg$FAILED) {
          if (input.length > peg$currPos) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c153); }
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c154(s3);
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$currPos;
        s2 = peg$currPos;
        peg$silentFails++;
        if (input.charCodeAt(peg$currPos) === 34) {
          s3 = peg$c148;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c149); }
        }
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = void 0;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c151) {
            s3 = peg$c151;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c152); }
          }
          if (s3 === peg$FAILED) {
            if (input.length > peg$currPos) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c153); }
            }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c154(s3);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      }

      return s0;
    }

    function peg$parseunquotedstring() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsenonsep();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c155(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsenonsep() {
      var s0, s1, s2, s3;

      s0 = [];
      s1 = peg$currPos;
      s2 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 44) {
        s3 = peg$c2;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c3); }
      }
      if (s3 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 59) {
          s3 = peg$c5;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c6); }
        }
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 123) {
            s3 = peg$c47;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c48); }
          }
        }
      }
      peg$silentFails--;
      if (s3 === peg$FAILED) {
        s2 = void 0;
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c153); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s1;
          s2 = peg$c154(s3);
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$currPos;
        s2 = peg$currPos;
        peg$silentFails++;
        if (input.charCodeAt(peg$currPos) === 44) {
          s3 = peg$c2;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c3); }
        }
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 59) {
            s3 = peg$c5;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c6); }
          }
          if (s3 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 123) {
              s3 = peg$c47;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c48); }
            }
          }
        }
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = void 0;
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c153); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s1;
            s2 = peg$c154(s3);
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1, s2;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = [];
      if (peg$c157.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c158); }
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          if (peg$c157.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c158); }
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c159(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$parsequotedstring();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c156); }
      }

      return s0;
    }

    function peg$parsewhitespace() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (peg$c161.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c162); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c154(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c160); }
      }

      return s0;
    }

    function peg$parselineend() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      if (peg$c164.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c165); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c154(s1);
      }
      s0 = s1;
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c163); }
      }

      return s0;
    }

    function peg$parsemlcomstart() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c166) {
        s0 = peg$c166;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c167); }
      }

      return s0;
    }

    function peg$parsemlcomend() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c168) {
        s0 = peg$c168;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c169); }
      }

      return s0;
    }

    function peg$parsemlcomtok() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c168) {
        s2 = peg$c168;
        peg$currPos += 2;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c169); }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = void 0;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c153); }
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c154(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsemlcomment() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parsemlcomstart();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsemlcomtok();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsemlcomtok();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsemlcomend();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c170(s1, s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseslcomstart() {
      var s0;

      if (input.substr(peg$currPos, 2) === peg$c171) {
        s0 = peg$c171;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c172); }
      }
      if (s0 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 35) {
          s0 = peg$c173;
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c174); }
        }
      }

      return s0;
    }

    function peg$parseslcomtok() {
      var s0;

      if (peg$c175.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c176); }
      }

      return s0;
    }

    function peg$parseslcomment() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseslcomstart();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseslcomtok();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseslcomtok();
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c177(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsecomment() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parseslcomment();
      if (s0 === peg$FAILED) {
        s0 = peg$parsemlcomment();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c178); }
      }

      return s0;
    }

    function peg$parse_() {
      var s0, s1;

      s0 = [];
      s1 = peg$parsewhitespace();
      if (s1 === peg$FAILED) {
        s1 = peg$parselineend();
        if (s1 === peg$FAILED) {
          s1 = peg$parsecomment();
        }
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parsewhitespace();
        if (s1 === peg$FAILED) {
          s1 = peg$parselineend();
          if (s1 === peg$FAILED) {
            s1 = peg$parsecomment();
          }
        }
      }

      return s0;
    }

    function peg$parsenumberlike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsenumberlikestring();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c180(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parsenumber();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c181(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c179); }
      }

      return s0;
    }

    function peg$parsenumberlikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c148;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c149); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsenumber();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c148;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c149); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c182(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsenumber() {
      var s0;

      s0 = peg$parsereal();
      if (s0 === peg$FAILED) {
        s0 = peg$parsecardinal();
      }

      return s0;
    }

    function peg$parsecardinal() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      if (peg$c183.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c184); }
      }
      if (s2 !== peg$FAILED) {
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          if (peg$c183.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c184); }
          }
        }
      } else {
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c185(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsereal() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$parsecardinal();
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s3 = peg$c186;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c187); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsecardinal();
          if (s4 !== peg$FAILED) {
            s2 = [s2, s3, s4];
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c188(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebooleanlike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsebooleanlikestring();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c190(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseboolean();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c191(s1);
        }
        s0 = s1;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c189); }
      }

      return s0;
    }

    function peg$parsebooleanlikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c148;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c149); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseboolean();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c148;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c149); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c180(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parseboolean() {
      var s0;

      if (input.substr(peg$currPos, 4).toLowerCase() === peg$c192) {
        s0 = input.substr(peg$currPos, 4);
        peg$currPos += 4;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c193); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 5).toLowerCase() === peg$c194) {
          s0 = input.substr(peg$currPos, 5);
          peg$currPos += 5;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c195); }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2).toLowerCase() === peg$c196) {
            s0 = input.substr(peg$currPos, 2);
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 3).toLowerCase() === peg$c198) {
              s0 = input.substr(peg$currPos, 3);
              peg$currPos += 3;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c199); }
            }
            if (s0 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 48) {
                s0 = peg$c200;
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c201); }
              }
              if (s0 === peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 49) {
                  s0 = peg$c202;
                  peg$currPos++;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c203); }
                }
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesizelike() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parsesizelikestring();
      if (s0 === peg$FAILED) {
        s0 = peg$parsesize();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c204); }
      }

      return s0;
    }

    function peg$parsesizelikestring() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c148;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c149); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesize();
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c148;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c149); }
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c180(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }

      return s0;
    }

    function peg$parsesize() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsenumber();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c205(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 4).toLowerCase() === peg$c206) {
          s1 = input.substr(peg$currPos, 4);
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c207); }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c208(s1);
        }
        s0 = s1;
      }

      return s0;
    }


        function merge(pBase, pObjectToMerge){
            pBase = pBase || {};
            if (pObjectToMerge){
                Object.getOwnPropertyNames(pObjectToMerge).forEach(function(pAttribute){
                    pBase[pAttribute] = pObjectToMerge[pAttribute];
                });
            }
            return pBase;
        }

        function optionArray2Object (pOptionList) {
            var lOptionList = {};
            pOptionList.forEach(function(lOption){
                lOptionList = merge(lOptionList, lOption);
            });
            return lOptionList;
        }

        function flattenBoolean(pBoolean) {
            return (["true", "on", "1"].indexOf(pBoolean.toLowerCase()) > -1);
        }

        function nameValue2Option(pName, pValue){
            var lOption = {};
            lOption[pName.toLowerCase()] = pValue;
            return lOption;
        }

        function entityExists (pEntities, pName, pEntityNamesToIgnore) {
            if (pName === undefined || pName === "*") {
                return true;
            }
            if (pEntities.some(function(pEntity){
                return pEntity.name === pName;
            })){
                return true;
            }
            return pEntityNamesToIgnore[pName] === true;
        }

        function initEntity(lName) {
            var lEntity = {};
            lEntity.name = lName;
            return lEntity;
        }

        function extractUndeclaredEntities (pEntities, pArcLines, pEntityNamesToIgnore) {
            if (!pEntities) {
                pEntities = [];
            }

            if (!pEntityNamesToIgnore){
                pEntityNamesToIgnore = {};
            }

            if (pArcLines) {
                pArcLines.forEach(function(pArcLine){
                    pArcLine.forEach(function(pArc){
                        if (!entityExists (pEntities, pArc.from, pEntityNamesToIgnore)) {
                            pEntities.push(initEntity(pArc.from));
                        }
                        // if the arc kind is arcspanning recurse into its arcs
                        if (pArc.arcs){
                            pEntityNamesToIgnore[pArc.to] = true;
                            merge (pEntities, extractUndeclaredEntities (pEntities, pArc.arcs, pEntityNamesToIgnore));
                            delete pEntityNamesToIgnore[pArc.to];
                        }
                        if (!entityExists (pEntities, pArc.to, pEntityNamesToIgnore)) {
                            pEntities.push(initEntity(pArc.to));
                        }
                    });
                });
            }
            return pEntities;
        }

        function hasExtendedOptions (pOptions){
            if (pOptions){
                return (
                         pOptions.hasOwnProperty("watermark")
                      || pOptions.hasOwnProperty("wordwrapentities")
                      || pOptions.hasOwnProperty("wordwrapboxes")
                      || ( pOptions.hasOwnProperty("width") && pOptions.width === "auto")
                );
            } else {
                return false;
            }
        }

        function hasExtendedArcTypes(pArcLines){
            if (pArcLines){
                return pArcLines.some(function(pArcLine){
                    return pArcLine.some(function(pArc){
                        return (["alt", "else", "opt", "break", "par",
                          "seq", "strict", "neg", "critical",
                          "ignore", "consider", "assert",
                          "loop", "ref", "exc"].indexOf(pArc.kind) > -1);
                    });
                });
            }
            return false;
        }

        function getMetaInfo(pOptions, pArcLines){
            var lHasExtendedOptions  = hasExtendedOptions(pOptions);
            var lHasExtendedArcTypes = hasExtendedArcTypes(pArcLines);
            return {
                "extendedOptions" : lHasExtendedOptions,
                "extendedArcTypes": lHasExtendedArcTypes,
                "extendedFeatures": lHasExtendedOptions||lHasExtendedArcTypes
            }
        }


    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail(peg$endExpectation());
      }

      throw peg$buildStructuredError(
        peg$maxFailExpected,
        peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
        peg$maxFailPos < input.length
          ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
          : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
      );
    }
  }

  return {
    SyntaxError: peg$SyntaxError,
    parse:       peg$parse
  };
});

/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/domprimitives',[],function() {
    "use strict";

    var SVGNS   = "http://www.w3.org/2000/svg";
    var XLINKNS = "http://www.w3.org/1999/xlink";

    var gDocument = {};

    function _setAttribute(pObject, pAttribute, pValue) {
        if (Boolean(pValue)){
            pObject.setAttribute(pAttribute, pValue);
        }
        return pObject;
    }

    function _setAttributeNS(pObject, pNS, pAttribute, pValue) {
        if (Boolean(pValue)){
            pObject.setAttributeNS(pNS, pAttribute, pValue);
        }
        return pObject;
    }

    function _setAttributes(pObject, pAttributes) {
        if (pAttributes){
            Object.keys(pAttributes).forEach(function(pKey){
                _setAttribute(pObject, pKey, pAttributes[pKey]);
            });
        }
        return pObject;
    }

    function _setAttributesNS(pObject, pNS, pAttributes) {
        if (pAttributes){
            Object.keys(pAttributes).forEach(function(pKey){
                _setAttributeNS(pObject, pNS, pKey, pAttributes[pKey]);
            });
        }
        return pObject;
    }

    function _createElement(pElementType, pAttributes){
        return _setAttributes(
            gDocument.createElementNS(SVGNS, pElementType),
            pAttributes
        );
    }

    function _createTextNode(pText) {
        return gDocument.createTextNode(pText);
    }

    return {
        SVGNS: SVGNS,
        XLINKNS: XLINKNS,

        /**
         * Function to set the document to use. Introduced to enable use of the
         * rendering utilities under node.js (using the jsdom module)
         *
         * @param {document} pDocument
         */
        init: function(pDocument) {
            gDocument = pDocument;
        },
        /**
         * Takes an element, adds the passed attribute and value to it
         * if the value is truthy and returns the element again
         *
         * @param {element} pElement
         * @param {string} pAttribute
         * @param {string} pValue
         * @return {element}
         */
        setAttribute: _setAttribute,

        /**
         * Takes an element, adds the passed attributes to it if they have
         * a value and returns it.
         *
         * @param {element} pElement
         * @param {object} pAttributes - names/ values object
         * @return {element}
         */
        setAttributes: _setAttributes,

        /**
         * Takes an element, adds the passed attributes to it if they have
         * a value and returns it.
         *
         * @param {element} pElement
         * @param {string} pNS - the namespace to use for the attributes
         * @param {object} pAttributes - names/ values object
         * @return {element}
         */
        setAttributesNS: _setAttributesNS,

        /**
         * creates the element of type pElementType in the SVG namespace,
         * adds the passed pAttributes to it (see setAttributes)
         * and returns the newly created element
         *
         * @param {string} pElementType
         * @param {object} pAttributes - names/ values object
         * @return {element}
         */
        createElement: _createElement,

        /**
         * creates a textNode, initialized with the pText passed
         *
         * @param {string} pText
         * @return {textNode}
         */
        createTextNode: _createTextNode

    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/geometry',[],function() {
    "use strict";

    function rad2deg(pDegrees){
        return (pDegrees * 360) / (2 * Math.PI);
    }

    return {
        /**
         * returns the angle (in degrees) of the line from the
         * bottom left to the top right of the bounding box.
         *
         * @param {object} pBBox - the bounding box (only width and height used)
         * @returns {number} - the angle in degrees
         */
        // elementfactory
        getDiagonalAngle: function (pBBox) {
            return 0 - rad2deg(Math.atan(pBBox.height / pBBox.width));
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/**
 * @license
 * Lodash (Custom Build) <https://lodash.com/>
 * Build: `lodash exports="umd" include="memoize,cloneDeep,flatten,defaults" --development --output lib/lodash/lodash.custom.js`
 * Copyright JS Foundation and other contributors <https://js.foundation/>
 * Released under MIT license <https://lodash.com/license>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 */
;(function() {

  /** Used as a safe reference for `undefined` in pre-ES5 environments. */
  var undefined;

  /** Used as the semantic version number. */
  var VERSION = '4.17.4';

  /** Used as the size to enable large array optimizations. */
  var LARGE_ARRAY_SIZE = 200;

  /** Error message constants. */
  var FUNC_ERROR_TEXT = 'Expected a function';

  /** Used to stand-in for `undefined` hash values. */
  var HASH_UNDEFINED = '__lodash_hash_undefined__';

  /** Used to compose bitmasks for cloning. */
  var CLONE_DEEP_FLAG = 1,
      CLONE_FLAT_FLAG = 2,
      CLONE_SYMBOLS_FLAG = 4;

  /** Used to detect hot functions by number of calls within a span of milliseconds. */
  var HOT_COUNT = 800,
      HOT_SPAN = 16;

  /** Used as references for various `Number` constants. */
  var MAX_SAFE_INTEGER = 9007199254740991;

  /** `Object#toString` result references. */
  var argsTag = '[object Arguments]',
      arrayTag = '[object Array]',
      asyncTag = '[object AsyncFunction]',
      boolTag = '[object Boolean]',
      dateTag = '[object Date]',
      errorTag = '[object Error]',
      funcTag = '[object Function]',
      genTag = '[object GeneratorFunction]',
      mapTag = '[object Map]',
      numberTag = '[object Number]',
      nullTag = '[object Null]',
      objectTag = '[object Object]',
      promiseTag = '[object Promise]',
      proxyTag = '[object Proxy]',
      regexpTag = '[object RegExp]',
      setTag = '[object Set]',
      stringTag = '[object String]',
      symbolTag = '[object Symbol]',
      undefinedTag = '[object Undefined]',
      weakMapTag = '[object WeakMap]';

  var arrayBufferTag = '[object ArrayBuffer]',
      dataViewTag = '[object DataView]',
      float32Tag = '[object Float32Array]',
      float64Tag = '[object Float64Array]',
      int8Tag = '[object Int8Array]',
      int16Tag = '[object Int16Array]',
      int32Tag = '[object Int32Array]',
      uint8Tag = '[object Uint8Array]',
      uint8ClampedTag = '[object Uint8ClampedArray]',
      uint16Tag = '[object Uint16Array]',
      uint32Tag = '[object Uint32Array]';

  /**
   * Used to match `RegExp`
   * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
   */
  var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

  /** Used to match `RegExp` flags from their coerced string values. */
  var reFlags = /\w*$/;

  /** Used to detect host constructors (Safari). */
  var reIsHostCtor = /^\[object .+?Constructor\]$/;

  /** Used to detect unsigned integer values. */
  var reIsUint = /^(?:0|[1-9]\d*)$/;

  /** Used to identify `toStringTag` values of typed arrays. */
  var typedArrayTags = {};
  typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
  typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
  typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
  typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
  typedArrayTags[uint32Tag] = true;
  typedArrayTags[argsTag] = typedArrayTags[arrayTag] =
  typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
  typedArrayTags[dataViewTag] = typedArrayTags[dateTag] =
  typedArrayTags[errorTag] = typedArrayTags[funcTag] =
  typedArrayTags[mapTag] = typedArrayTags[numberTag] =
  typedArrayTags[objectTag] = typedArrayTags[regexpTag] =
  typedArrayTags[setTag] = typedArrayTags[stringTag] =
  typedArrayTags[weakMapTag] = false;

  /** Used to identify `toStringTag` values supported by `_.clone`. */
  var cloneableTags = {};
  cloneableTags[argsTag] = cloneableTags[arrayTag] =
  cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] =
  cloneableTags[boolTag] = cloneableTags[dateTag] =
  cloneableTags[float32Tag] = cloneableTags[float64Tag] =
  cloneableTags[int8Tag] = cloneableTags[int16Tag] =
  cloneableTags[int32Tag] = cloneableTags[mapTag] =
  cloneableTags[numberTag] = cloneableTags[objectTag] =
  cloneableTags[regexpTag] = cloneableTags[setTag] =
  cloneableTags[stringTag] = cloneableTags[symbolTag] =
  cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] =
  cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
  cloneableTags[errorTag] = cloneableTags[funcTag] =
  cloneableTags[weakMapTag] = false;

  /** Detect free variable `global` from Node.js. */
  var freeGlobal = typeof global == 'object' && global && global.Object === Object && global;

  /** Detect free variable `self`. */
  var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

  /** Used as a reference to the global object. */
  var root = freeGlobal || freeSelf || Function('return this')();

  /** Detect free variable `exports`. */
  var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;

  /** Detect the popular CommonJS extension `module.exports`. */
  var moduleExports = freeModule && freeModule.exports === freeExports;

  /** Detect free variable `process` from Node.js. */
  var freeProcess = moduleExports && freeGlobal.process;

  /** Used to access faster Node.js helpers. */
  var nodeUtil = (function() {
    try {
      return freeProcess && freeProcess.binding && freeProcess.binding('util');
    } catch (e) {}
  }());

  /* Node.js helper references. */
  var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;

  /*--------------------------------------------------------------------------*/

  /**
   * Adds the key-value `pair` to `map`.
   *
   * @private
   * @param {Object} map The map to modify.
   * @param {Array} pair The key-value pair to add.
   * @returns {Object} Returns `map`.
   */
  function addMapEntry(map, pair) {
    // Don't return `map.set` because it's not chainable in IE 11.
    map.set(pair[0], pair[1]);
    return map;
  }

  /**
   * Adds `value` to `set`.
   *
   * @private
   * @param {Object} set The set to modify.
   * @param {*} value The value to add.
   * @returns {Object} Returns `set`.
   */
  function addSetEntry(set, value) {
    // Don't return `set.add` because it's not chainable in IE 11.
    set.add(value);
    return set;
  }

  /**
   * A faster alternative to `Function#apply`, this function invokes `func`
   * with the `this` binding of `thisArg` and the arguments of `args`.
   *
   * @private
   * @param {Function} func The function to invoke.
   * @param {*} thisArg The `this` binding of `func`.
   * @param {Array} args The arguments to invoke `func` with.
   * @returns {*} Returns the result of `func`.
   */
  function apply(func, thisArg, args) {
    switch (args.length) {
      case 0: return func.call(thisArg);
      case 1: return func.call(thisArg, args[0]);
      case 2: return func.call(thisArg, args[0], args[1]);
      case 3: return func.call(thisArg, args[0], args[1], args[2]);
    }
    return func.apply(thisArg, args);
  }

  /**
   * A specialized version of `_.forEach` for arrays without support for
   * iteratee shorthands.
   *
   * @private
   * @param {Array} [array] The array to iterate over.
   * @param {Function} iteratee The function invoked per iteration.
   * @returns {Array} Returns `array`.
   */
  function arrayEach(array, iteratee) {
    var index = -1,
        length = array == null ? 0 : array.length;

    while (++index < length) {
      if (iteratee(array[index], index, array) === false) {
        break;
      }
    }
    return array;
  }

  /**
   * A specialized version of `_.filter` for arrays without support for
   * iteratee shorthands.
   *
   * @private
   * @param {Array} [array] The array to iterate over.
   * @param {Function} predicate The function invoked per iteration.
   * @returns {Array} Returns the new filtered array.
   */
  function arrayFilter(array, predicate) {
    var index = -1,
        length = array == null ? 0 : array.length,
        resIndex = 0,
        result = [];

    while (++index < length) {
      var value = array[index];
      if (predicate(value, index, array)) {
        result[resIndex++] = value;
      }
    }
    return result;
  }

  /**
   * Appends the elements of `values` to `array`.
   *
   * @private
   * @param {Array} array The array to modify.
   * @param {Array} values The values to append.
   * @returns {Array} Returns `array`.
   */
  function arrayPush(array, values) {
    var index = -1,
        length = values.length,
        offset = array.length;

    while (++index < length) {
      array[offset + index] = values[index];
    }
    return array;
  }

  /**
   * A specialized version of `_.reduce` for arrays without support for
   * iteratee shorthands.
   *
   * @private
   * @param {Array} [array] The array to iterate over.
   * @param {Function} iteratee The function invoked per iteration.
   * @param {*} [accumulator] The initial value.
   * @param {boolean} [initAccum] Specify using the first element of `array` as
   *  the initial value.
   * @returns {*} Returns the accumulated value.
   */
  function arrayReduce(array, iteratee, accumulator, initAccum) {
    var index = -1,
        length = array == null ? 0 : array.length;

    if (initAccum && length) {
      accumulator = array[++index];
    }
    while (++index < length) {
      accumulator = iteratee(accumulator, array[index], index, array);
    }
    return accumulator;
  }

  /**
   * The base implementation of `_.times` without support for iteratee shorthands
   * or max array length checks.
   *
   * @private
   * @param {number} n The number of times to invoke `iteratee`.
   * @param {Function} iteratee The function invoked per iteration.
   * @returns {Array} Returns the array of results.
   */
  function baseTimes(n, iteratee) {
    var index = -1,
        result = Array(n);

    while (++index < n) {
      result[index] = iteratee(index);
    }
    return result;
  }

  /**
   * The base implementation of `_.unary` without support for storing metadata.
   *
   * @private
   * @param {Function} func The function to cap arguments for.
   * @returns {Function} Returns the new capped function.
   */
  function baseUnary(func) {
    return function(value) {
      return func(value);
    };
  }

  /**
   * Gets the value at `key` of `object`.
   *
   * @private
   * @param {Object} [object] The object to query.
   * @param {string} key The key of the property to get.
   * @returns {*} Returns the property value.
   */
  function getValue(object, key) {
    return object == null ? undefined : object[key];
  }

  /**
   * Converts `map` to its key-value pairs.
   *
   * @private
   * @param {Object} map The map to convert.
   * @returns {Array} Returns the key-value pairs.
   */
  function mapToArray(map) {
    var index = -1,
        result = Array(map.size);

    map.forEach(function(value, key) {
      result[++index] = [key, value];
    });
    return result;
  }

  /**
   * Creates a unary function that invokes `func` with its argument transformed.
   *
   * @private
   * @param {Function} func The function to wrap.
   * @param {Function} transform The argument transform.
   * @returns {Function} Returns the new function.
   */
  function overArg(func, transform) {
    return function(arg) {
      return func(transform(arg));
    };
  }

  /**
   * Converts `set` to an array of its values.
   *
   * @private
   * @param {Object} set The set to convert.
   * @returns {Array} Returns the values.
   */
  function setToArray(set) {
    var index = -1,
        result = Array(set.size);

    set.forEach(function(value) {
      result[++index] = value;
    });
    return result;
  }

  /*--------------------------------------------------------------------------*/

  /** Used for built-in method references. */
  var arrayProto = Array.prototype,
      funcProto = Function.prototype,
      objectProto = Object.prototype;

  /** Used to detect overreaching core-js shims. */
  var coreJsData = root['__core-js_shared__'];

  /** Used to resolve the decompiled source of functions. */
  var funcToString = funcProto.toString;

  /** Used to check objects for own properties. */
  var hasOwnProperty = objectProto.hasOwnProperty;

  /** Used to detect methods masquerading as native. */
  var maskSrcKey = (function() {
    var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
    return uid ? ('Symbol(src)_1.' + uid) : '';
  }());

  /**
   * Used to resolve the
   * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
   * of values.
   */
  var nativeObjectToString = objectProto.toString;

  /** Used to detect if a method is native. */
  var reIsNative = RegExp('^' +
    funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
    .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
  );

  /** Built-in value references. */
  var Buffer = moduleExports ? root.Buffer : undefined,
      Symbol = root.Symbol,
      Uint8Array = root.Uint8Array,
      allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined,
      getPrototype = overArg(Object.getPrototypeOf, Object),
      objectCreate = Object.create,
      propertyIsEnumerable = objectProto.propertyIsEnumerable,
      splice = arrayProto.splice,
      spreadableSymbol = Symbol ? Symbol.isConcatSpreadable : undefined,
      symToStringTag = Symbol ? Symbol.toStringTag : undefined;

  var defineProperty = (function() {
    try {
      var func = getNative(Object, 'defineProperty');
      func({}, '', {});
      return func;
    } catch (e) {}
  }());

  /* Built-in method references for those with the same name as other `lodash` methods. */
  var nativeGetSymbols = Object.getOwnPropertySymbols,
      nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
      nativeKeys = overArg(Object.keys, Object),
      nativeMax = Math.max,
      nativeNow = Date.now;

  /* Built-in method references that are verified to be native. */
  var DataView = getNative(root, 'DataView'),
      Map = getNative(root, 'Map'),
      Promise = getNative(root, 'Promise'),
      Set = getNative(root, 'Set'),
      WeakMap = getNative(root, 'WeakMap'),
      nativeCreate = getNative(Object, 'create');

  /** Used to lookup unminified function names. */
  var realNames = {};

  /** Used to detect maps, sets, and weakmaps. */
  var dataViewCtorString = toSource(DataView),
      mapCtorString = toSource(Map),
      promiseCtorString = toSource(Promise),
      setCtorString = toSource(Set),
      weakMapCtorString = toSource(WeakMap);

  /** Used to convert symbols to primitives and strings. */
  var symbolProto = Symbol ? Symbol.prototype : undefined,
      symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

  /*------------------------------------------------------------------------*/

  /**
   * Creates a `lodash` object which wraps `value` to enable implicit method
   * chain sequences. Methods that operate on and return arrays, collections,
   * and functions can be chained together. Methods that retrieve a single value
   * or may return a primitive value will automatically end the chain sequence
   * and return the unwrapped value. Otherwise, the value must be unwrapped
   * with `_#value`.
   *
   * Explicit chain sequences, which must be unwrapped with `_#value`, may be
   * enabled using `_.chain`.
   *
   * The execution of chained methods is lazy, that is, it's deferred until
   * `_#value` is implicitly or explicitly called.
   *
   * Lazy evaluation allows several methods to support shortcut fusion.
   * Shortcut fusion is an optimization to merge iteratee calls; this avoids
   * the creation of intermediate arrays and can greatly reduce the number of
   * iteratee executions. Sections of a chain sequence qualify for shortcut
   * fusion if the section is applied to an array and iteratees accept only
   * one argument. The heuristic for whether a section qualifies for shortcut
   * fusion is subject to change.
   *
   * Chaining is supported in custom builds as long as the `_#value` method is
   * directly or indirectly included in the build.
   *
   * In addition to lodash methods, wrappers have `Array` and `String` methods.
   *
   * The wrapper `Array` methods are:
   * `concat`, `join`, `pop`, `push`, `shift`, `sort`, `splice`, and `unshift`
   *
   * The wrapper `String` methods are:
   * `replace` and `split`
   *
   * The wrapper methods that support shortcut fusion are:
   * `at`, `compact`, `drop`, `dropRight`, `dropWhile`, `filter`, `find`,
   * `findLast`, `head`, `initial`, `last`, `map`, `reject`, `reverse`, `slice`,
   * `tail`, `take`, `takeRight`, `takeRightWhile`, `takeWhile`, and `toArray`
   *
   * The chainable wrapper methods are:
   * `after`, `ary`, `assign`, `assignIn`, `assignInWith`, `assignWith`, `at`,
   * `before`, `bind`, `bindAll`, `bindKey`, `castArray`, `chain`, `chunk`,
   * `commit`, `compact`, `concat`, `conforms`, `constant`, `countBy`, `create`,
   * `curry`, `debounce`, `defaults`, `defaultsDeep`, `defer`, `delay`,
   * `difference`, `differenceBy`, `differenceWith`, `drop`, `dropRight`,
   * `dropRightWhile`, `dropWhile`, `extend`, `extendWith`, `fill`, `filter`,
   * `flatMap`, `flatMapDeep`, `flatMapDepth`, `flatten`, `flattenDeep`,
   * `flattenDepth`, `flip`, `flow`, `flowRight`, `fromPairs`, `functions`,
   * `functionsIn`, `groupBy`, `initial`, `intersection`, `intersectionBy`,
   * `intersectionWith`, `invert`, `invertBy`, `invokeMap`, `iteratee`, `keyBy`,
   * `keys`, `keysIn`, `map`, `mapKeys`, `mapValues`, `matches`, `matchesProperty`,
   * `memoize`, `merge`, `mergeWith`, `method`, `methodOf`, `mixin`, `negate`,
   * `nthArg`, `omit`, `omitBy`, `once`, `orderBy`, `over`, `overArgs`,
   * `overEvery`, `overSome`, `partial`, `partialRight`, `partition`, `pick`,
   * `pickBy`, `plant`, `property`, `propertyOf`, `pull`, `pullAll`, `pullAllBy`,
   * `pullAllWith`, `pullAt`, `push`, `range`, `rangeRight`, `rearg`, `reject`,
   * `remove`, `rest`, `reverse`, `sampleSize`, `set`, `setWith`, `shuffle`,
   * `slice`, `sort`, `sortBy`, `splice`, `spread`, `tail`, `take`, `takeRight`,
   * `takeRightWhile`, `takeWhile`, `tap`, `throttle`, `thru`, `toArray`,
   * `toPairs`, `toPairsIn`, `toPath`, `toPlainObject`, `transform`, `unary`,
   * `union`, `unionBy`, `unionWith`, `uniq`, `uniqBy`, `uniqWith`, `unset`,
   * `unshift`, `unzip`, `unzipWith`, `update`, `updateWith`, `values`,
   * `valuesIn`, `without`, `wrap`, `xor`, `xorBy`, `xorWith`, `zip`,
   * `zipObject`, `zipObjectDeep`, and `zipWith`
   *
   * The wrapper methods that are **not** chainable by default are:
   * `add`, `attempt`, `camelCase`, `capitalize`, `ceil`, `clamp`, `clone`,
   * `cloneDeep`, `cloneDeepWith`, `cloneWith`, `conformsTo`, `deburr`,
   * `defaultTo`, `divide`, `each`, `eachRight`, `endsWith`, `eq`, `escape`,
   * `escapeRegExp`, `every`, `find`, `findIndex`, `findKey`, `findLast`,
   * `findLastIndex`, `findLastKey`, `first`, `floor`, `forEach`, `forEachRight`,
   * `forIn`, `forInRight`, `forOwn`, `forOwnRight`, `get`, `gt`, `gte`, `has`,
   * `hasIn`, `head`, `identity`, `includes`, `indexOf`, `inRange`, `invoke`,
   * `isArguments`, `isArray`, `isArrayBuffer`, `isArrayLike`, `isArrayLikeObject`,
   * `isBoolean`, `isBuffer`, `isDate`, `isElement`, `isEmpty`, `isEqual`,
   * `isEqualWith`, `isError`, `isFinite`, `isFunction`, `isInteger`, `isLength`,
   * `isMap`, `isMatch`, `isMatchWith`, `isNaN`, `isNative`, `isNil`, `isNull`,
   * `isNumber`, `isObject`, `isObjectLike`, `isPlainObject`, `isRegExp`,
   * `isSafeInteger`, `isSet`, `isString`, `isUndefined`, `isTypedArray`,
   * `isWeakMap`, `isWeakSet`, `join`, `kebabCase`, `last`, `lastIndexOf`,
   * `lowerCase`, `lowerFirst`, `lt`, `lte`, `max`, `maxBy`, `mean`, `meanBy`,
   * `min`, `minBy`, `multiply`, `noConflict`, `noop`, `now`, `nth`, `pad`,
   * `padEnd`, `padStart`, `parseInt`, `pop`, `random`, `reduce`, `reduceRight`,
   * `repeat`, `result`, `round`, `runInContext`, `sample`, `shift`, `size`,
   * `snakeCase`, `some`, `sortedIndex`, `sortedIndexBy`, `sortedLastIndex`,
   * `sortedLastIndexBy`, `startCase`, `startsWith`, `stubArray`, `stubFalse`,
   * `stubObject`, `stubString`, `stubTrue`, `subtract`, `sum`, `sumBy`,
   * `template`, `times`, `toFinite`, `toInteger`, `toJSON`, `toLength`,
   * `toLower`, `toNumber`, `toSafeInteger`, `toString`, `toUpper`, `trim`,
   * `trimEnd`, `trimStart`, `truncate`, `unescape`, `uniqueId`, `upperCase`,
   * `upperFirst`, `value`, and `words`
   *
   * @name _
   * @constructor
   * @category Seq
   * @param {*} value The value to wrap in a `lodash` instance.
   * @returns {Object} Returns the new `lodash` wrapper instance.
   * @example
   *
   * function square(n) {
   *   return n * n;
   * }
   *
   * var wrapped = _([1, 2, 3]);
   *
   * // Returns an unwrapped value.
   * wrapped.reduce(_.add);
   * // => 6
   *
   * // Returns a wrapped value.
   * var squares = wrapped.map(square);
   *
   * _.isArray(squares);
   * // => false
   *
   * _.isArray(squares.value());
   * // => true
   */
  function lodash() {
    // No operation performed.
  }

  /**
   * The base implementation of `_.create` without support for assigning
   * properties to the created object.
   *
   * @private
   * @param {Object} proto The object to inherit from.
   * @returns {Object} Returns the new object.
   */
  var baseCreate = (function() {
    function object() {}
    return function(proto) {
      if (!isObject(proto)) {
        return {};
      }
      if (objectCreate) {
        return objectCreate(proto);
      }
      object.prototype = proto;
      var result = new object;
      object.prototype = undefined;
      return result;
    };
  }());

  /*------------------------------------------------------------------------*/

  /**
   * Creates a hash object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function Hash(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  /**
   * Removes all key-value entries from the hash.
   *
   * @private
   * @name clear
   * @memberOf Hash
   */
  function hashClear() {
    this.__data__ = nativeCreate ? nativeCreate(null) : {};
    this.size = 0;
  }

  /**
   * Removes `key` and its value from the hash.
   *
   * @private
   * @name delete
   * @memberOf Hash
   * @param {Object} hash The hash to modify.
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function hashDelete(key) {
    var result = this.has(key) && delete this.__data__[key];
    this.size -= result ? 1 : 0;
    return result;
  }

  /**
   * Gets the hash value for `key`.
   *
   * @private
   * @name get
   * @memberOf Hash
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function hashGet(key) {
    var data = this.__data__;
    if (nativeCreate) {
      var result = data[key];
      return result === HASH_UNDEFINED ? undefined : result;
    }
    return hasOwnProperty.call(data, key) ? data[key] : undefined;
  }

  /**
   * Checks if a hash value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf Hash
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function hashHas(key) {
    var data = this.__data__;
    return nativeCreate ? (data[key] !== undefined) : hasOwnProperty.call(data, key);
  }

  /**
   * Sets the hash `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf Hash
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the hash instance.
   */
  function hashSet(key, value) {
    var data = this.__data__;
    this.size += this.has(key) ? 0 : 1;
    data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED : value;
    return this;
  }

  // Add methods to `Hash`.
  Hash.prototype.clear = hashClear;
  Hash.prototype['delete'] = hashDelete;
  Hash.prototype.get = hashGet;
  Hash.prototype.has = hashHas;
  Hash.prototype.set = hashSet;

  /*------------------------------------------------------------------------*/

  /**
   * Creates an list cache object.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function ListCache(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  /**
   * Removes all key-value entries from the list cache.
   *
   * @private
   * @name clear
   * @memberOf ListCache
   */
  function listCacheClear() {
    this.__data__ = [];
    this.size = 0;
  }

  /**
   * Removes `key` and its value from the list cache.
   *
   * @private
   * @name delete
   * @memberOf ListCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function listCacheDelete(key) {
    var data = this.__data__,
        index = assocIndexOf(data, key);

    if (index < 0) {
      return false;
    }
    var lastIndex = data.length - 1;
    if (index == lastIndex) {
      data.pop();
    } else {
      splice.call(data, index, 1);
    }
    --this.size;
    return true;
  }

  /**
   * Gets the list cache value for `key`.
   *
   * @private
   * @name get
   * @memberOf ListCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function listCacheGet(key) {
    var data = this.__data__,
        index = assocIndexOf(data, key);

    return index < 0 ? undefined : data[index][1];
  }

  /**
   * Checks if a list cache value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf ListCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function listCacheHas(key) {
    return assocIndexOf(this.__data__, key) > -1;
  }

  /**
   * Sets the list cache `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf ListCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the list cache instance.
   */
  function listCacheSet(key, value) {
    var data = this.__data__,
        index = assocIndexOf(data, key);

    if (index < 0) {
      ++this.size;
      data.push([key, value]);
    } else {
      data[index][1] = value;
    }
    return this;
  }

  // Add methods to `ListCache`.
  ListCache.prototype.clear = listCacheClear;
  ListCache.prototype['delete'] = listCacheDelete;
  ListCache.prototype.get = listCacheGet;
  ListCache.prototype.has = listCacheHas;
  ListCache.prototype.set = listCacheSet;

  /*------------------------------------------------------------------------*/

  /**
   * Creates a map cache object to store key-value pairs.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function MapCache(entries) {
    var index = -1,
        length = entries == null ? 0 : entries.length;

    this.clear();
    while (++index < length) {
      var entry = entries[index];
      this.set(entry[0], entry[1]);
    }
  }

  /**
   * Removes all key-value entries from the map.
   *
   * @private
   * @name clear
   * @memberOf MapCache
   */
  function mapCacheClear() {
    this.size = 0;
    this.__data__ = {
      'hash': new Hash,
      'map': new (Map || ListCache),
      'string': new Hash
    };
  }

  /**
   * Removes `key` and its value from the map.
   *
   * @private
   * @name delete
   * @memberOf MapCache
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function mapCacheDelete(key) {
    var result = getMapData(this, key)['delete'](key);
    this.size -= result ? 1 : 0;
    return result;
  }

  /**
   * Gets the map value for `key`.
   *
   * @private
   * @name get
   * @memberOf MapCache
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function mapCacheGet(key) {
    return getMapData(this, key).get(key);
  }

  /**
   * Checks if a map value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf MapCache
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function mapCacheHas(key) {
    return getMapData(this, key).has(key);
  }

  /**
   * Sets the map `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf MapCache
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the map cache instance.
   */
  function mapCacheSet(key, value) {
    var data = getMapData(this, key),
        size = data.size;

    data.set(key, value);
    this.size += data.size == size ? 0 : 1;
    return this;
  }

  // Add methods to `MapCache`.
  MapCache.prototype.clear = mapCacheClear;
  MapCache.prototype['delete'] = mapCacheDelete;
  MapCache.prototype.get = mapCacheGet;
  MapCache.prototype.has = mapCacheHas;
  MapCache.prototype.set = mapCacheSet;

  /*------------------------------------------------------------------------*/

  /**
   * Creates a stack cache object to store key-value pairs.
   *
   * @private
   * @constructor
   * @param {Array} [entries] The key-value pairs to cache.
   */
  function Stack(entries) {
    var data = this.__data__ = new ListCache(entries);
    this.size = data.size;
  }

  /**
   * Removes all key-value entries from the stack.
   *
   * @private
   * @name clear
   * @memberOf Stack
   */
  function stackClear() {
    this.__data__ = new ListCache;
    this.size = 0;
  }

  /**
   * Removes `key` and its value from the stack.
   *
   * @private
   * @name delete
   * @memberOf Stack
   * @param {string} key The key of the value to remove.
   * @returns {boolean} Returns `true` if the entry was removed, else `false`.
   */
  function stackDelete(key) {
    var data = this.__data__,
        result = data['delete'](key);

    this.size = data.size;
    return result;
  }

  /**
   * Gets the stack value for `key`.
   *
   * @private
   * @name get
   * @memberOf Stack
   * @param {string} key The key of the value to get.
   * @returns {*} Returns the entry value.
   */
  function stackGet(key) {
    return this.__data__.get(key);
  }

  /**
   * Checks if a stack value for `key` exists.
   *
   * @private
   * @name has
   * @memberOf Stack
   * @param {string} key The key of the entry to check.
   * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
   */
  function stackHas(key) {
    return this.__data__.has(key);
  }

  /**
   * Sets the stack `key` to `value`.
   *
   * @private
   * @name set
   * @memberOf Stack
   * @param {string} key The key of the value to set.
   * @param {*} value The value to set.
   * @returns {Object} Returns the stack cache instance.
   */
  function stackSet(key, value) {
    var data = this.__data__;
    if (data instanceof ListCache) {
      var pairs = data.__data__;
      if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
        pairs.push([key, value]);
        this.size = ++data.size;
        return this;
      }
      data = this.__data__ = new MapCache(pairs);
    }
    data.set(key, value);
    this.size = data.size;
    return this;
  }

  // Add methods to `Stack`.
  Stack.prototype.clear = stackClear;
  Stack.prototype['delete'] = stackDelete;
  Stack.prototype.get = stackGet;
  Stack.prototype.has = stackHas;
  Stack.prototype.set = stackSet;

  /*------------------------------------------------------------------------*/

  /**
   * Creates an array of the enumerable property names of the array-like `value`.
   *
   * @private
   * @param {*} value The value to query.
   * @param {boolean} inherited Specify returning inherited property names.
   * @returns {Array} Returns the array of property names.
   */
  function arrayLikeKeys(value, inherited) {
    var isArr = isArray(value),
        isArg = !isArr && isArguments(value),
        isBuff = !isArr && !isArg && isBuffer(value),
        isType = !isArr && !isArg && !isBuff && isTypedArray(value),
        skipIndexes = isArr || isArg || isBuff || isType,
        result = skipIndexes ? baseTimes(value.length, String) : [],
        length = result.length;

    for (var key in value) {
      if ((inherited || hasOwnProperty.call(value, key)) &&
          !(skipIndexes && (
             // Safari 9 has enumerable `arguments.length` in strict mode.
             key == 'length' ||
             // Node.js 0.10 has enumerable non-index properties on buffers.
             (isBuff && (key == 'offset' || key == 'parent')) ||
             // PhantomJS 2 has enumerable non-index properties on typed arrays.
             (isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset')) ||
             // Skip index properties.
             isIndex(key, length)
          ))) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Assigns `value` to `key` of `object` if the existing value is not equivalent
   * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
   * for equality comparisons.
   *
   * @private
   * @param {Object} object The object to modify.
   * @param {string} key The key of the property to assign.
   * @param {*} value The value to assign.
   */
  function assignValue(object, key, value) {
    var objValue = object[key];
    if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) ||
        (value === undefined && !(key in object))) {
      baseAssignValue(object, key, value);
    }
  }

  /**
   * Gets the index at which the `key` is found in `array` of key-value pairs.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {*} key The key to search for.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function assocIndexOf(array, key) {
    var length = array.length;
    while (length--) {
      if (eq(array[length][0], key)) {
        return length;
      }
    }
    return -1;
  }

  /**
   * The base implementation of `_.assign` without support for multiple sources
   * or `customizer` functions.
   *
   * @private
   * @param {Object} object The destination object.
   * @param {Object} source The source object.
   * @returns {Object} Returns `object`.
   */
  function baseAssign(object, source) {
    return object && copyObject(source, keys(source), object);
  }

  /**
   * The base implementation of `_.assignIn` without support for multiple sources
   * or `customizer` functions.
   *
   * @private
   * @param {Object} object The destination object.
   * @param {Object} source The source object.
   * @returns {Object} Returns `object`.
   */
  function baseAssignIn(object, source) {
    return object && copyObject(source, keysIn(source), object);
  }

  /**
   * The base implementation of `assignValue` and `assignMergeValue` without
   * value checks.
   *
   * @private
   * @param {Object} object The object to modify.
   * @param {string} key The key of the property to assign.
   * @param {*} value The value to assign.
   */
  function baseAssignValue(object, key, value) {
    if (key == '__proto__' && defineProperty) {
      defineProperty(object, key, {
        'configurable': true,
        'enumerable': true,
        'value': value,
        'writable': true
      });
    } else {
      object[key] = value;
    }
  }

  /**
   * The base implementation of `_.clone` and `_.cloneDeep` which tracks
   * traversed objects.
   *
   * @private
   * @param {*} value The value to clone.
   * @param {boolean} bitmask The bitmask flags.
   *  1 - Deep clone
   *  2 - Flatten inherited properties
   *  4 - Clone symbols
   * @param {Function} [customizer] The function to customize cloning.
   * @param {string} [key] The key of `value`.
   * @param {Object} [object] The parent object of `value`.
   * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
   * @returns {*} Returns the cloned value.
   */
  function baseClone(value, bitmask, customizer, key, object, stack) {
    var result,
        isDeep = bitmask & CLONE_DEEP_FLAG,
        isFlat = bitmask & CLONE_FLAT_FLAG,
        isFull = bitmask & CLONE_SYMBOLS_FLAG;

    if (customizer) {
      result = object ? customizer(value, key, object, stack) : customizer(value);
    }
    if (result !== undefined) {
      return result;
    }
    if (!isObject(value)) {
      return value;
    }
    var isArr = isArray(value);
    if (isArr) {
      result = initCloneArray(value);
      if (!isDeep) {
        return copyArray(value, result);
      }
    } else {
      var tag = getTag(value),
          isFunc = tag == funcTag || tag == genTag;

      if (isBuffer(value)) {
        return cloneBuffer(value, isDeep);
      }
      if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
        result = (isFlat || isFunc) ? {} : initCloneObject(value);
        if (!isDeep) {
          return isFlat
            ? copySymbolsIn(value, baseAssignIn(result, value))
            : copySymbols(value, baseAssign(result, value));
        }
      } else {
        if (!cloneableTags[tag]) {
          return object ? value : {};
        }
        result = initCloneByTag(value, tag, baseClone, isDeep);
      }
    }
    // Check for circular references and return its corresponding clone.
    stack || (stack = new Stack);
    var stacked = stack.get(value);
    if (stacked) {
      return stacked;
    }
    stack.set(value, result);

    var keysFunc = isFull
      ? (isFlat ? getAllKeysIn : getAllKeys)
      : (isFlat ? keysIn : keys);

    var props = isArr ? undefined : keysFunc(value);
    arrayEach(props || value, function(subValue, key) {
      if (props) {
        key = subValue;
        subValue = value[key];
      }
      // Recursively populate clone (susceptible to call stack limits).
      assignValue(result, key, baseClone(subValue, bitmask, customizer, key, value, stack));
    });
    return result;
  }

  /**
   * The base implementation of `_.flatten` with support for restricting flattening.
   *
   * @private
   * @param {Array} array The array to flatten.
   * @param {number} depth The maximum recursion depth.
   * @param {boolean} [predicate=isFlattenable] The function invoked per iteration.
   * @param {boolean} [isStrict] Restrict to values that pass `predicate` checks.
   * @param {Array} [result=[]] The initial result value.
   * @returns {Array} Returns the new flattened array.
   */
  function baseFlatten(array, depth, predicate, isStrict, result) {
    var index = -1,
        length = array.length;

    predicate || (predicate = isFlattenable);
    result || (result = []);

    while (++index < length) {
      var value = array[index];
      if (depth > 0 && predicate(value)) {
        if (depth > 1) {
          // Recursively flatten arrays (susceptible to call stack limits).
          baseFlatten(value, depth - 1, predicate, isStrict, result);
        } else {
          arrayPush(result, value);
        }
      } else if (!isStrict) {
        result[result.length] = value;
      }
    }
    return result;
  }

  /**
   * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
   * `keysFunc` and `symbolsFunc` to get the enumerable property names and
   * symbols of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @param {Function} keysFunc The function to get the keys of `object`.
   * @param {Function} symbolsFunc The function to get the symbols of `object`.
   * @returns {Array} Returns the array of property names and symbols.
   */
  function baseGetAllKeys(object, keysFunc, symbolsFunc) {
    var result = keysFunc(object);
    return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
  }

  /**
   * The base implementation of `getTag` without fallbacks for buggy environments.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the `toStringTag`.
   */
  function baseGetTag(value) {
    if (value == null) {
      return value === undefined ? undefinedTag : nullTag;
    }
    return (symToStringTag && symToStringTag in Object(value))
      ? getRawTag(value)
      : objectToString(value);
  }

  /**
   * The base implementation of `_.isArguments`.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an `arguments` object,
   */
  function baseIsArguments(value) {
    return isObjectLike(value) && baseGetTag(value) == argsTag;
  }

  /**
   * The base implementation of `_.isNative` without bad shim checks.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a native function,
   *  else `false`.
   */
  function baseIsNative(value) {
    if (!isObject(value) || isMasked(value)) {
      return false;
    }
    var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
    return pattern.test(toSource(value));
  }

  /**
   * The base implementation of `_.isTypedArray` without Node.js optimizations.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
   */
  function baseIsTypedArray(value) {
    return isObjectLike(value) &&
      isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
  }

  /**
   * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   */
  function baseKeys(object) {
    if (!isPrototype(object)) {
      return nativeKeys(object);
    }
    var result = [];
    for (var key in Object(object)) {
      if (hasOwnProperty.call(object, key) && key != 'constructor') {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   */
  function baseKeysIn(object) {
    if (!isObject(object)) {
      return nativeKeysIn(object);
    }
    var isProto = isPrototype(object),
        result = [];

    for (var key in object) {
      if (!(key == 'constructor' && (isProto || !hasOwnProperty.call(object, key)))) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * The base implementation of `_.rest` which doesn't validate or coerce arguments.
   *
   * @private
   * @param {Function} func The function to apply a rest parameter to.
   * @param {number} [start=func.length-1] The start position of the rest parameter.
   * @returns {Function} Returns the new function.
   */
  function baseRest(func, start) {
    return setToString(overRest(func, start, identity), func + '');
  }

  /**
   * The base implementation of `setToString` without support for hot loop shorting.
   *
   * @private
   * @param {Function} func The function to modify.
   * @param {Function} string The `toString` result.
   * @returns {Function} Returns `func`.
   */
  var baseSetToString = !defineProperty ? identity : function(func, string) {
    return defineProperty(func, 'toString', {
      'configurable': true,
      'enumerable': false,
      'value': constant(string),
      'writable': true
    });
  };

  /**
   * Creates a clone of  `buffer`.
   *
   * @private
   * @param {Buffer} buffer The buffer to clone.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Buffer} Returns the cloned buffer.
   */
  function cloneBuffer(buffer, isDeep) {
    if (isDeep) {
      return buffer.slice();
    }
    var length = buffer.length,
        result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);

    buffer.copy(result);
    return result;
  }

  /**
   * Creates a clone of `arrayBuffer`.
   *
   * @private
   * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
   * @returns {ArrayBuffer} Returns the cloned array buffer.
   */
  function cloneArrayBuffer(arrayBuffer) {
    var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
    new Uint8Array(result).set(new Uint8Array(arrayBuffer));
    return result;
  }

  /**
   * Creates a clone of `dataView`.
   *
   * @private
   * @param {Object} dataView The data view to clone.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the cloned data view.
   */
  function cloneDataView(dataView, isDeep) {
    var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
    return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
  }

  /**
   * Creates a clone of `map`.
   *
   * @private
   * @param {Object} map The map to clone.
   * @param {Function} cloneFunc The function to clone values.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the cloned map.
   */
  function cloneMap(map, isDeep, cloneFunc) {
    var array = isDeep ? cloneFunc(mapToArray(map), CLONE_DEEP_FLAG) : mapToArray(map);
    return arrayReduce(array, addMapEntry, new map.constructor);
  }

  /**
   * Creates a clone of `regexp`.
   *
   * @private
   * @param {Object} regexp The regexp to clone.
   * @returns {Object} Returns the cloned regexp.
   */
  function cloneRegExp(regexp) {
    var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
    result.lastIndex = regexp.lastIndex;
    return result;
  }

  /**
   * Creates a clone of `set`.
   *
   * @private
   * @param {Object} set The set to clone.
   * @param {Function} cloneFunc The function to clone values.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the cloned set.
   */
  function cloneSet(set, isDeep, cloneFunc) {
    var array = isDeep ? cloneFunc(setToArray(set), CLONE_DEEP_FLAG) : setToArray(set);
    return arrayReduce(array, addSetEntry, new set.constructor);
  }

  /**
   * Creates a clone of the `symbol` object.
   *
   * @private
   * @param {Object} symbol The symbol object to clone.
   * @returns {Object} Returns the cloned symbol object.
   */
  function cloneSymbol(symbol) {
    return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
  }

  /**
   * Creates a clone of `typedArray`.
   *
   * @private
   * @param {Object} typedArray The typed array to clone.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the cloned typed array.
   */
  function cloneTypedArray(typedArray, isDeep) {
    var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
    return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
  }

  /**
   * Copies the values of `source` to `array`.
   *
   * @private
   * @param {Array} source The array to copy values from.
   * @param {Array} [array=[]] The array to copy values to.
   * @returns {Array} Returns `array`.
   */
  function copyArray(source, array) {
    var index = -1,
        length = source.length;

    array || (array = Array(length));
    while (++index < length) {
      array[index] = source[index];
    }
    return array;
  }

  /**
   * Copies properties of `source` to `object`.
   *
   * @private
   * @param {Object} source The object to copy properties from.
   * @param {Array} props The property identifiers to copy.
   * @param {Object} [object={}] The object to copy properties to.
   * @param {Function} [customizer] The function to customize copied values.
   * @returns {Object} Returns `object`.
   */
  function copyObject(source, props, object, customizer) {
    var isNew = !object;
    object || (object = {});

    var index = -1,
        length = props.length;

    while (++index < length) {
      var key = props[index];

      var newValue = customizer
        ? customizer(object[key], source[key], key, object, source)
        : undefined;

      if (newValue === undefined) {
        newValue = source[key];
      }
      if (isNew) {
        baseAssignValue(object, key, newValue);
      } else {
        assignValue(object, key, newValue);
      }
    }
    return object;
  }

  /**
   * Copies own symbols of `source` to `object`.
   *
   * @private
   * @param {Object} source The object to copy symbols from.
   * @param {Object} [object={}] The object to copy symbols to.
   * @returns {Object} Returns `object`.
   */
  function copySymbols(source, object) {
    return copyObject(source, getSymbols(source), object);
  }

  /**
   * Copies own and inherited symbols of `source` to `object`.
   *
   * @private
   * @param {Object} source The object to copy symbols from.
   * @param {Object} [object={}] The object to copy symbols to.
   * @returns {Object} Returns `object`.
   */
  function copySymbolsIn(source, object) {
    return copyObject(source, getSymbolsIn(source), object);
  }

  /**
   * Creates a function like `_.assign`.
   *
   * @private
   * @param {Function} assigner The function to assign values.
   * @returns {Function} Returns the new assigner function.
   */
  function createAssigner(assigner) {
    return baseRest(function(object, sources) {
      var index = -1,
          length = sources.length,
          customizer = length > 1 ? sources[length - 1] : undefined,
          guard = length > 2 ? sources[2] : undefined;

      customizer = (assigner.length > 3 && typeof customizer == 'function')
        ? (length--, customizer)
        : undefined;

      if (guard && isIterateeCall(sources[0], sources[1], guard)) {
        customizer = length < 3 ? undefined : customizer;
        length = 1;
      }
      object = Object(object);
      while (++index < length) {
        var source = sources[index];
        if (source) {
          assigner(object, source, index, customizer);
        }
      }
      return object;
    });
  }

  /**
   * Used by `_.defaults` to customize its `_.assignIn` use to assign properties
   * of source objects to the destination object for all destination properties
   * that resolve to `undefined`.
   *
   * @private
   * @param {*} objValue The destination value.
   * @param {*} srcValue The source value.
   * @param {string} key The key of the property to assign.
   * @param {Object} object The parent object of `objValue`.
   * @returns {*} Returns the value to assign.
   */
  function customDefaultsAssignIn(objValue, srcValue, key, object) {
    if (objValue === undefined ||
        (eq(objValue, objectProto[key]) && !hasOwnProperty.call(object, key))) {
      return srcValue;
    }
    return objValue;
  }

  /**
   * Creates an array of own enumerable property names and symbols of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names and symbols.
   */
  function getAllKeys(object) {
    return baseGetAllKeys(object, keys, getSymbols);
  }

  /**
   * Creates an array of own and inherited enumerable property names and
   * symbols of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names and symbols.
   */
  function getAllKeysIn(object) {
    return baseGetAllKeys(object, keysIn, getSymbolsIn);
  }

  /**
   * Gets the data for `map`.
   *
   * @private
   * @param {Object} map The map to query.
   * @param {string} key The reference key.
   * @returns {*} Returns the map data.
   */
  function getMapData(map, key) {
    var data = map.__data__;
    return isKeyable(key)
      ? data[typeof key == 'string' ? 'string' : 'hash']
      : data.map;
  }

  /**
   * Gets the native function at `key` of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @param {string} key The key of the method to get.
   * @returns {*} Returns the function if it's native, else `undefined`.
   */
  function getNative(object, key) {
    var value = getValue(object, key);
    return baseIsNative(value) ? value : undefined;
  }

  /**
   * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the raw `toStringTag`.
   */
  function getRawTag(value) {
    var isOwn = hasOwnProperty.call(value, symToStringTag),
        tag = value[symToStringTag];

    try {
      value[symToStringTag] = undefined;
      var unmasked = true;
    } catch (e) {}

    var result = nativeObjectToString.call(value);
    if (unmasked) {
      if (isOwn) {
        value[symToStringTag] = tag;
      } else {
        delete value[symToStringTag];
      }
    }
    return result;
  }

  /**
   * Creates an array of the own enumerable symbols of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of symbols.
   */
  var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
    if (object == null) {
      return [];
    }
    object = Object(object);
    return arrayFilter(nativeGetSymbols(object), function(symbol) {
      return propertyIsEnumerable.call(object, symbol);
    });
  };

  /**
   * Creates an array of the own and inherited enumerable symbols of `object`.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of symbols.
   */
  var getSymbolsIn = !nativeGetSymbols ? stubArray : function(object) {
    var result = [];
    while (object) {
      arrayPush(result, getSymbols(object));
      object = getPrototype(object);
    }
    return result;
  };

  /**
   * Gets the `toStringTag` of `value`.
   *
   * @private
   * @param {*} value The value to query.
   * @returns {string} Returns the `toStringTag`.
   */
  var getTag = baseGetTag;

  // Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.
  if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
      (Map && getTag(new Map) != mapTag) ||
      (Promise && getTag(Promise.resolve()) != promiseTag) ||
      (Set && getTag(new Set) != setTag) ||
      (WeakMap && getTag(new WeakMap) != weakMapTag)) {
    getTag = function(value) {
      var result = baseGetTag(value),
          Ctor = result == objectTag ? value.constructor : undefined,
          ctorString = Ctor ? toSource(Ctor) : '';

      if (ctorString) {
        switch (ctorString) {
          case dataViewCtorString: return dataViewTag;
          case mapCtorString: return mapTag;
          case promiseCtorString: return promiseTag;
          case setCtorString: return setTag;
          case weakMapCtorString: return weakMapTag;
        }
      }
      return result;
    };
  }

  /**
   * Initializes an array clone.
   *
   * @private
   * @param {Array} array The array to clone.
   * @returns {Array} Returns the initialized clone.
   */
  function initCloneArray(array) {
    var length = array.length,
        result = array.constructor(length);

    // Add properties assigned by `RegExp#exec`.
    if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
      result.index = array.index;
      result.input = array.input;
    }
    return result;
  }

  /**
   * Initializes an object clone.
   *
   * @private
   * @param {Object} object The object to clone.
   * @returns {Object} Returns the initialized clone.
   */
  function initCloneObject(object) {
    return (typeof object.constructor == 'function' && !isPrototype(object))
      ? baseCreate(getPrototype(object))
      : {};
  }

  /**
   * Initializes an object clone based on its `toStringTag`.
   *
   * **Note:** This function only supports cloning values with tags of
   * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
   *
   * @private
   * @param {Object} object The object to clone.
   * @param {string} tag The `toStringTag` of the object to clone.
   * @param {Function} cloneFunc The function to clone values.
   * @param {boolean} [isDeep] Specify a deep clone.
   * @returns {Object} Returns the initialized clone.
   */
  function initCloneByTag(object, tag, cloneFunc, isDeep) {
    var Ctor = object.constructor;
    switch (tag) {
      case arrayBufferTag:
        return cloneArrayBuffer(object);

      case boolTag:
      case dateTag:
        return new Ctor(+object);

      case dataViewTag:
        return cloneDataView(object, isDeep);

      case float32Tag: case float64Tag:
      case int8Tag: case int16Tag: case int32Tag:
      case uint8Tag: case uint8ClampedTag: case uint16Tag: case uint32Tag:
        return cloneTypedArray(object, isDeep);

      case mapTag:
        return cloneMap(object, isDeep, cloneFunc);

      case numberTag:
      case stringTag:
        return new Ctor(object);

      case regexpTag:
        return cloneRegExp(object);

      case setTag:
        return cloneSet(object, isDeep, cloneFunc);

      case symbolTag:
        return cloneSymbol(object);
    }
  }

  /**
   * Checks if `value` is a flattenable `arguments` object or array.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is flattenable, else `false`.
   */
  function isFlattenable(value) {
    return isArray(value) || isArguments(value) ||
      !!(spreadableSymbol && value && value[spreadableSymbol]);
  }

  /**
   * Checks if `value` is a valid array-like index.
   *
   * @private
   * @param {*} value The value to check.
   * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
   * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
   */
  function isIndex(value, length) {
    length = length == null ? MAX_SAFE_INTEGER : length;
    return !!length &&
      (typeof value == 'number' || reIsUint.test(value)) &&
      (value > -1 && value % 1 == 0 && value < length);
  }

  /**
   * Checks if the given arguments are from an iteratee call.
   *
   * @private
   * @param {*} value The potential iteratee value argument.
   * @param {*} index The potential iteratee index or key argument.
   * @param {*} object The potential iteratee object argument.
   * @returns {boolean} Returns `true` if the arguments are from an iteratee call,
   *  else `false`.
   */
  function isIterateeCall(value, index, object) {
    if (!isObject(object)) {
      return false;
    }
    var type = typeof index;
    if (type == 'number'
          ? (isArrayLike(object) && isIndex(index, object.length))
          : (type == 'string' && index in object)
        ) {
      return eq(object[index], value);
    }
    return false;
  }

  /**
   * Checks if `value` is suitable for use as unique object key.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
   */
  function isKeyable(value) {
    var type = typeof value;
    return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
      ? (value !== '__proto__')
      : (value === null);
  }

  /**
   * Checks if `func` has its source masked.
   *
   * @private
   * @param {Function} func The function to check.
   * @returns {boolean} Returns `true` if `func` is masked, else `false`.
   */
  function isMasked(func) {
    return !!maskSrcKey && (maskSrcKey in func);
  }

  /**
   * Checks if `value` is likely a prototype object.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
   */
  function isPrototype(value) {
    var Ctor = value && value.constructor,
        proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

    return value === proto;
  }

  /**
   * This function is like
   * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
   * except that it includes inherited enumerable properties.
   *
   * @private
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   */
  function nativeKeysIn(object) {
    var result = [];
    if (object != null) {
      for (var key in Object(object)) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Converts `value` to a string using `Object.prototype.toString`.
   *
   * @private
   * @param {*} value The value to convert.
   * @returns {string} Returns the converted string.
   */
  function objectToString(value) {
    return nativeObjectToString.call(value);
  }

  /**
   * A specialized version of `baseRest` which transforms the rest array.
   *
   * @private
   * @param {Function} func The function to apply a rest parameter to.
   * @param {number} [start=func.length-1] The start position of the rest parameter.
   * @param {Function} transform The rest array transform.
   * @returns {Function} Returns the new function.
   */
  function overRest(func, start, transform) {
    start = nativeMax(start === undefined ? (func.length - 1) : start, 0);
    return function() {
      var args = arguments,
          index = -1,
          length = nativeMax(args.length - start, 0),
          array = Array(length);

      while (++index < length) {
        array[index] = args[start + index];
      }
      index = -1;
      var otherArgs = Array(start + 1);
      while (++index < start) {
        otherArgs[index] = args[index];
      }
      otherArgs[start] = transform(array);
      return apply(func, this, otherArgs);
    };
  }

  /**
   * Sets the `toString` method of `func` to return `string`.
   *
   * @private
   * @param {Function} func The function to modify.
   * @param {Function} string The `toString` result.
   * @returns {Function} Returns `func`.
   */
  var setToString = shortOut(baseSetToString);

  /**
   * Creates a function that'll short out and invoke `identity` instead
   * of `func` when it's called `HOT_COUNT` or more times in `HOT_SPAN`
   * milliseconds.
   *
   * @private
   * @param {Function} func The function to restrict.
   * @returns {Function} Returns the new shortable function.
   */
  function shortOut(func) {
    var count = 0,
        lastCalled = 0;

    return function() {
      var stamp = nativeNow(),
          remaining = HOT_SPAN - (stamp - lastCalled);

      lastCalled = stamp;
      if (remaining > 0) {
        if (++count >= HOT_COUNT) {
          return arguments[0];
        }
      } else {
        count = 0;
      }
      return func.apply(undefined, arguments);
    };
  }

  /**
   * Converts `func` to its source code.
   *
   * @private
   * @param {Function} func The function to convert.
   * @returns {string} Returns the source code.
   */
  function toSource(func) {
    if (func != null) {
      try {
        return funcToString.call(func);
      } catch (e) {}
      try {
        return (func + '');
      } catch (e) {}
    }
    return '';
  }

  /*------------------------------------------------------------------------*/

  /**
   * Flattens `array` a single level deep.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Array
   * @param {Array} array The array to flatten.
   * @returns {Array} Returns the new flattened array.
   * @example
   *
   * _.flatten([1, [2, [3, [4]], 5]]);
   * // => [1, 2, [3, [4]], 5]
   */
  function flatten(array) {
    var length = array == null ? 0 : array.length;
    return length ? baseFlatten(array, 1) : [];
  }

  /*------------------------------------------------------------------------*/

  /**
   * Creates a function that memoizes the result of `func`. If `resolver` is
   * provided, it determines the cache key for storing the result based on the
   * arguments provided to the memoized function. By default, the first argument
   * provided to the memoized function is used as the map cache key. The `func`
   * is invoked with the `this` binding of the memoized function.
   *
   * **Note:** The cache is exposed as the `cache` property on the memoized
   * function. Its creation may be customized by replacing the `_.memoize.Cache`
   * constructor with one whose instances implement the
   * [`Map`](http://ecma-international.org/ecma-262/7.0/#sec-properties-of-the-map-prototype-object)
   * method interface of `clear`, `delete`, `get`, `has`, and `set`.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Function
   * @param {Function} func The function to have its output memoized.
   * @param {Function} [resolver] The function to resolve the cache key.
   * @returns {Function} Returns the new memoized function.
   * @example
   *
   * var object = { 'a': 1, 'b': 2 };
   * var other = { 'c': 3, 'd': 4 };
   *
   * var values = _.memoize(_.values);
   * values(object);
   * // => [1, 2]
   *
   * values(other);
   * // => [3, 4]
   *
   * object.a = 2;
   * values(object);
   * // => [1, 2]
   *
   * // Modify the result cache.
   * values.cache.set(object, ['a', 'b']);
   * values(object);
   * // => ['a', 'b']
   *
   * // Replace `_.memoize.Cache`.
   * _.memoize.Cache = WeakMap;
   */
  function memoize(func, resolver) {
    if (typeof func != 'function' || (resolver != null && typeof resolver != 'function')) {
      throw new TypeError(FUNC_ERROR_TEXT);
    }
    var memoized = function() {
      var args = arguments,
          key = resolver ? resolver.apply(this, args) : args[0],
          cache = memoized.cache;

      if (cache.has(key)) {
        return cache.get(key);
      }
      var result = func.apply(this, args);
      memoized.cache = cache.set(key, result) || cache;
      return result;
    };
    memoized.cache = new (memoize.Cache || MapCache);
    return memoized;
  }

  // Expose `MapCache`.
  memoize.Cache = MapCache;

  /*------------------------------------------------------------------------*/

  /**
   * This method is like `_.clone` except that it recursively clones `value`.
   *
   * @static
   * @memberOf _
   * @since 1.0.0
   * @category Lang
   * @param {*} value The value to recursively clone.
   * @returns {*} Returns the deep cloned value.
   * @see _.clone
   * @example
   *
   * var objects = [{ 'a': 1 }, { 'b': 2 }];
   *
   * var deep = _.cloneDeep(objects);
   * console.log(deep[0] === objects[0]);
   * // => false
   */
  function cloneDeep(value) {
    return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
  }

  /**
   * Performs a
   * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
   * comparison between two values to determine if they are equivalent.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to compare.
   * @param {*} other The other value to compare.
   * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
   * @example
   *
   * var object = { 'a': 1 };
   * var other = { 'a': 1 };
   *
   * _.eq(object, object);
   * // => true
   *
   * _.eq(object, other);
   * // => false
   *
   * _.eq('a', 'a');
   * // => true
   *
   * _.eq('a', Object('a'));
   * // => false
   *
   * _.eq(NaN, NaN);
   * // => true
   */
  function eq(value, other) {
    return value === other || (value !== value && other !== other);
  }

  /**
   * Checks if `value` is likely an `arguments` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an `arguments` object,
   *  else `false`.
   * @example
   *
   * _.isArguments(function() { return arguments; }());
   * // => true
   *
   * _.isArguments([1, 2, 3]);
   * // => false
   */
  var isArguments = baseIsArguments(function() { return arguments; }()) ? baseIsArguments : function(value) {
    return isObjectLike(value) && hasOwnProperty.call(value, 'callee') &&
      !propertyIsEnumerable.call(value, 'callee');
  };

  /**
   * Checks if `value` is classified as an `Array` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an array, else `false`.
   * @example
   *
   * _.isArray([1, 2, 3]);
   * // => true
   *
   * _.isArray(document.body.children);
   * // => false
   *
   * _.isArray('abc');
   * // => false
   *
   * _.isArray(_.noop);
   * // => false
   */
  var isArray = Array.isArray;

  /**
   * Checks if `value` is array-like. A value is considered array-like if it's
   * not a function and has a `value.length` that's an integer greater than or
   * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
   * @example
   *
   * _.isArrayLike([1, 2, 3]);
   * // => true
   *
   * _.isArrayLike(document.body.children);
   * // => true
   *
   * _.isArrayLike('abc');
   * // => true
   *
   * _.isArrayLike(_.noop);
   * // => false
   */
  function isArrayLike(value) {
    return value != null && isLength(value.length) && !isFunction(value);
  }

  /**
   * Checks if `value` is a buffer.
   *
   * @static
   * @memberOf _
   * @since 4.3.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
   * @example
   *
   * _.isBuffer(new Buffer(2));
   * // => true
   *
   * _.isBuffer(new Uint8Array(2));
   * // => false
   */
  var isBuffer = nativeIsBuffer || stubFalse;

  /**
   * Checks if `value` is classified as a `Function` object.
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a function, else `false`.
   * @example
   *
   * _.isFunction(_);
   * // => true
   *
   * _.isFunction(/abc/);
   * // => false
   */
  function isFunction(value) {
    if (!isObject(value)) {
      return false;
    }
    // The use of `Object#toString` avoids issues with the `typeof` operator
    // in Safari 9 which returns 'object' for typed arrays and other constructors.
    var tag = baseGetTag(value);
    return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
  }

  /**
   * Checks if `value` is a valid array-like length.
   *
   * **Note:** This method is loosely based on
   * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
   * @example
   *
   * _.isLength(3);
   * // => true
   *
   * _.isLength(Number.MIN_VALUE);
   * // => false
   *
   * _.isLength(Infinity);
   * // => false
   *
   * _.isLength('3');
   * // => false
   */
  function isLength(value) {
    return typeof value == 'number' &&
      value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
  }

  /**
   * Checks if `value` is the
   * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
   * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
   *
   * @static
   * @memberOf _
   * @since 0.1.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is an object, else `false`.
   * @example
   *
   * _.isObject({});
   * // => true
   *
   * _.isObject([1, 2, 3]);
   * // => true
   *
   * _.isObject(_.noop);
   * // => true
   *
   * _.isObject(null);
   * // => false
   */
  function isObject(value) {
    var type = typeof value;
    return value != null && (type == 'object' || type == 'function');
  }

  /**
   * Checks if `value` is object-like. A value is object-like if it's not `null`
   * and has a `typeof` result of "object".
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
   * @example
   *
   * _.isObjectLike({});
   * // => true
   *
   * _.isObjectLike([1, 2, 3]);
   * // => true
   *
   * _.isObjectLike(_.noop);
   * // => false
   *
   * _.isObjectLike(null);
   * // => false
   */
  function isObjectLike(value) {
    return value != null && typeof value == 'object';
  }

  /**
   * Checks if `value` is classified as a typed array.
   *
   * @static
   * @memberOf _
   * @since 3.0.0
   * @category Lang
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
   * @example
   *
   * _.isTypedArray(new Uint8Array);
   * // => true
   *
   * _.isTypedArray([]);
   * // => false
   */
  var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;

  /*------------------------------------------------------------------------*/

  /**
   * This method is like `_.assignIn` except that it accepts `customizer`
   * which is invoked to produce the assigned values. If `customizer` returns
   * `undefined`, assignment is handled by the method instead. The `customizer`
   * is invoked with five arguments: (objValue, srcValue, key, object, source).
   *
   * **Note:** This method mutates `object`.
   *
   * @static
   * @memberOf _
   * @since 4.0.0
   * @alias extendWith
   * @category Object
   * @param {Object} object The destination object.
   * @param {...Object} sources The source objects.
   * @param {Function} [customizer] The function to customize assigned values.
   * @returns {Object} Returns `object`.
   * @see _.assignWith
   * @example
   *
   * function customizer(objValue, srcValue) {
   *   return _.isUndefined(objValue) ? srcValue : objValue;
   * }
   *
   * var defaults = _.partialRight(_.assignInWith, customizer);
   *
   * defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 });
   * // => { 'a': 1, 'b': 2 }
   */
  var assignInWith = createAssigner(function(object, source, srcIndex, customizer) {
    copyObject(source, keysIn(source), object, customizer);
  });

  /**
   * Assigns own and inherited enumerable string keyed properties of source
   * objects to the destination object for all destination properties that
   * resolve to `undefined`. Source objects are applied from left to right.
   * Once a property is set, additional values of the same property are ignored.
   *
   * **Note:** This method mutates `object`.
   *
   * @static
   * @since 0.1.0
   * @memberOf _
   * @category Object
   * @param {Object} object The destination object.
   * @param {...Object} [sources] The source objects.
   * @returns {Object} Returns `object`.
   * @see _.defaultsDeep
   * @example
   *
   * _.defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 });
   * // => { 'a': 1, 'b': 2 }
   */
  var defaults = baseRest(function(args) {
    args.push(undefined, customDefaultsAssignIn);
    return apply(assignInWith, undefined, args);
  });

  /**
   * Creates an array of the own enumerable property names of `object`.
   *
   * **Note:** Non-object values are coerced to objects. See the
   * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
   * for more details.
   *
   * @static
   * @since 0.1.0
   * @memberOf _
   * @category Object
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   * @example
   *
   * function Foo() {
   *   this.a = 1;
   *   this.b = 2;
   * }
   *
   * Foo.prototype.c = 3;
   *
   * _.keys(new Foo);
   * // => ['a', 'b'] (iteration order is not guaranteed)
   *
   * _.keys('hi');
   * // => ['0', '1']
   */
  function keys(object) {
    return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
  }

  /**
   * Creates an array of the own and inherited enumerable property names of `object`.
   *
   * **Note:** Non-object values are coerced to objects.
   *
   * @static
   * @memberOf _
   * @since 3.0.0
   * @category Object
   * @param {Object} object The object to query.
   * @returns {Array} Returns the array of property names.
   * @example
   *
   * function Foo() {
   *   this.a = 1;
   *   this.b = 2;
   * }
   *
   * Foo.prototype.c = 3;
   *
   * _.keysIn(new Foo);
   * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
   */
  function keysIn(object) {
    return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
  }

  /*------------------------------------------------------------------------*/

  /**
   * Creates a function that returns `value`.
   *
   * @static
   * @memberOf _
   * @since 2.4.0
   * @category Util
   * @param {*} value The value to return from the new function.
   * @returns {Function} Returns the new constant function.
   * @example
   *
   * var objects = _.times(2, _.constant({ 'a': 1 }));
   *
   * console.log(objects);
   * // => [{ 'a': 1 }, { 'a': 1 }]
   *
   * console.log(objects[0] === objects[1]);
   * // => true
   */
  function constant(value) {
    return function() {
      return value;
    };
  }

  /**
   * This method returns the first argument it receives.
   *
   * @static
   * @since 0.1.0
   * @memberOf _
   * @category Util
   * @param {*} value Any value.
   * @returns {*} Returns `value`.
   * @example
   *
   * var object = { 'a': 1 };
   *
   * console.log(_.identity(object) === object);
   * // => true
   */
  function identity(value) {
    return value;
  }

  /**
   * This method returns a new empty array.
   *
   * @static
   * @memberOf _
   * @since 4.13.0
   * @category Util
   * @returns {Array} Returns the new empty array.
   * @example
   *
   * var arrays = _.times(2, _.stubArray);
   *
   * console.log(arrays);
   * // => [[], []]
   *
   * console.log(arrays[0] === arrays[1]);
   * // => false
   */
  function stubArray() {
    return [];
  }

  /**
   * This method returns `false`.
   *
   * @static
   * @memberOf _
   * @since 4.13.0
   * @category Util
   * @returns {boolean} Returns `false`.
   * @example
   *
   * _.times(2, _.stubFalse);
   * // => [false, false]
   */
  function stubFalse() {
    return false;
  }

  /*------------------------------------------------------------------------*/

  // Add methods that return wrapped values in chain sequences.
  lodash.assignInWith = assignInWith;
  lodash.constant = constant;
  lodash.defaults = defaults;
  lodash.flatten = flatten;
  lodash.keys = keys;
  lodash.keysIn = keysIn;
  lodash.memoize = memoize;

  // Add aliases.
  lodash.extendWith = assignInWith;

  /*------------------------------------------------------------------------*/

  // Add methods that return unwrapped values in chain sequences.
  lodash.cloneDeep = cloneDeep;
  lodash.eq = eq;
  lodash.identity = identity;
  lodash.isArguments = isArguments;
  lodash.isArray = isArray;
  lodash.isArrayLike = isArrayLike;
  lodash.isBuffer = isBuffer;
  lodash.isFunction = isFunction;
  lodash.isLength = isLength;
  lodash.isObject = isObject;
  lodash.isObjectLike = isObjectLike;
  lodash.isTypedArray = isTypedArray;
  lodash.stubArray = stubArray;
  lodash.stubFalse = stubFalse;

  /*------------------------------------------------------------------------*/

  /**
   * The semantic version number.
   *
   * @static
   * @memberOf _
   * @type {string}
   */
  lodash.VERSION = VERSION;

  /*--------------------------------------------------------------------------*/

  // Some AMD build optimizers, like r.js, check for condition patterns like:
  if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
    // Expose Lodash on the global object to prevent errors when Lodash is
    // loaded by a script tag in the presence of an AMD loader.
    // See http://requirejs.org/docs/errors.html#mismatch for more details.
    // Use `_.noConflict` to remove Lodash from the global object.
    root._ = lodash;

    // Define as an anonymous module so, through path mapping, it can be
    // referenced as the "underscore" module.
    define('lib/mscgenjs-core/lib/lodash/lodash.custom',[],function() {
      return lodash;
    });
  }
  // Check for `exports` after `define` in case a build optimizer adds it.
  else if (freeModule) {
    // Export for Node.js.
    (freeModule.exports = lodash)._ = lodash;
    // Export for CommonJS support.
    freeExports._ = lodash;
  }
  else {
    // Export to the global object.
    root._ = lodash;
  }
}.call(this));

/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/round',[],function() {
    "use strict";

    /**
     * Rounds pNumber to pPrecision numbers after the decimal separator
     *
     * e.g.:
     * - round(3.141592653589, 3) === 3.142
     * - round(2.7, 0) === round(2.7) === 3
     * - round(2.7, 10) === 2.7
     * - round(14.00000001, 2) === 14
     *
     * @param  {number} pNumber     The number to round
     * @param  {integer} pPrecision The number of decimals to keep. Optional.
     *                              Defaults to 0
     * @return number               The rounded number
     */
    return function (pNumber, pPrecision){
        return pPrecision
            ? Math.round(pNumber * Math.pow(10, pPrecision), pPrecision) / Math.pow(10, pPrecision)
            : Math.round(pNumber);
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/svgprimitives',['require','./domprimitives','./geometry','../../../lib/lodash/lodash.custom','./round'],function(require) {

    var domprimitives = require("./domprimitives");
    var geometry      = require("./geometry");
    var _             = require("../../../lib/lodash/lodash.custom");
    var round         = require("./round");
    var PRECISION     = 2;

    function point2String(pX, pY) {
        return round(pX, PRECISION).toString() + "," + round(pY, PRECISION).toString() + " ";
    }

    function pathPoint2String(pType, pX, pY) {
        return pType + point2String(pX, pY);
    }

    function _createMarker(pId, pClass, pOrient, pViewBox) {
        /* so, why not start at refX=0, refY=0? It would simplify reasoning
         * about marker paths significantly...
         *
         * TL;DR: canvg doesn't seem to handle this very well.
         * - Don't know yet why.
         * - Suspicion: with (0,0) the marker paths we use would end up having
         *   negative coordinates (e.g. "M 0 0 L -8 2" for a left to right
         *   signal)
         */
        return domprimitives.createElement(
            "marker",
            {
                orient: pOrient,
                id: pId,
                class: pClass,
                viewBox: Boolean(pViewBox) ? pViewBox : "0 0 10 10",
                refX: "9",
                refY: "3",
                markerUnits: "strokeWidth",
                markerWidth: "10",
                markerHeight: "10"
            }
        );
        /* for scaling to the lineWidth of the line the marker is attached to,
         * userSpaceOnUse looks like a good plan, but it is not only the
         * paths that don't scale, it's also the linewidth (which makes sense).
         * We'll have to roll our own path transformation algorithm if we want
         * to change only the linewidth and not the rest
         */

    }

    function createLink (pURL, pElementToWrap){
        var lA = domprimitives.createElement("a");
        domprimitives.setAttributesNS(
            lA,
            domprimitives.XLINKNS,
            {
                "xlink:href"  : pURL,
                "xlink:title" : pURL
            }
        );
        lA.appendChild(pElementToWrap);
        return lA;
    }

    /* superscript style could also be super or a number (1em) or a % (100%) */
    var lSuperscriptStyle = "vertical-align:text-top;";
    lSuperscriptStyle += "font-size:0.7em;text-anchor:start;";

    function createTSpan(pLabel, pURL){
        var lTSpanLabel = domprimitives.createElement("tspan");
        var lContent = domprimitives.createTextNode(pLabel);
        lTSpanLabel.appendChild(lContent);
        if (pURL) {
            return createLink(pURL, lTSpanLabel);
        } else {
            return lTSpanLabel;
        }
    }

    function _createText(pLabel, pCoords, pOptions) {
        var lOptions = _.defaults(
            pOptions, {
                class: null,
                url: null,
                id: null,
                idurl: null
            });
        var lText = domprimitives.createElement(
            "text",
            {
                x: round(pCoords.x, PRECISION).toString(),
                y: round(pCoords.y, PRECISION).toString(),
                class: lOptions.class
            }
        );

        lText.appendChild(createTSpan(pLabel, lOptions.url));

        if (lOptions.id) {
            var lTSpanID = createTSpan(" [" + lOptions.id + "]", lOptions.idurl);
            lTSpanID.setAttribute("style", lSuperscriptStyle);
            lText.appendChild(lTSpanID);
        }
        return lText;
    }

    /**
     * Creates an svg path element given the path pD, with pClass applied
     * (if provided)
     *
     * @param {string} pD - the path
     * @param {string} pOptions - an object with (optional) keys class, style, color and bgColor
     * @return {SVGElement}
     */
    function createPath(pD, pOptions) {
        var lOptions = _.defaults(
            pOptions,
            {
                class: null,
                style: null,
                color: null,
                bgColor: null
            }
        );
        return colorBox(
            domprimitives.createElement(
                "path",
                {
                    d: pD,
                    class: lOptions.class,
                    style: lOptions.style
                }
            ),
            lOptions.color,
            lOptions.bgColor
        );
    }


    function colorBox(pElement, pColor, pBgColor){
        var lStyleString = "";
        if (pBgColor) {
            lStyleString += "fill:" + pBgColor + ";";
        }
        if (pColor) {
            lStyleString += "stroke:" + pColor + ";";
        }
        return domprimitives.setAttribute(pElement, "style", lStyleString);
    }

    return {
        /**
         * Function to set the document to use. Introduced to enable use of the
         * rendering utilities under node.js (using the jsdom module)
         *
         * @param {document} pDocument
         */
        init: function(pDocument) {
            domprimitives.init(pDocument);
        },

        /**
         * Creates a basic SVG with id pId, and size 0x0
         * @param {string} pId
         * @return {Element} an SVG element
         */
        createSVG: function (pId, pClass) {
            return domprimitives.createElement(
                "svg",
                {
                    version: "1.1",
                    id: pId,
                    class: pClass,
                    xmlns: domprimitives.SVGNS,
                    "xmlns:xlink": domprimitives.XLINKNS,
                    width: "0",
                    height: "0"
                }
            );
        },

        updateSVG: function(pSVGElement, pAttributes) {
            domprimitives.setAttributes(pSVGElement, pAttributes);
        },

        // straight + internal for createPath => elementfactory, wobbly & straight
        colorBox         : colorBox,

        /**
         * Creates a desc element with id pId
         *
         * @param {string} pID
         * @returns {Element}
         */
        createDesc: function () {
            return domprimitives.createElement("desc");
        },

        /**
         * Creates an empty 'defs' element
         *
         * @returns {Element}
         */
        createDefs: function(){
            return domprimitives.createElement("defs");
        },

        /**
         * creates a tspan with label pLabel, optionally wrapped in a link
         * if the url pURL is passed
         *
         * @param  {string} pLabel
         * @param  {string} pURL
         * @return {element}
         */
        createTSpan: createTSpan,
        /**
         * Creates a text node with the appropriate tspan & a elements on
         * position pCoords.
         *
         * @param {string} pLabel
         * @param {object} pCoords
         * @param {object} pOptions - options to influence rendering
         *                          {string} pClass - reference to the css class to be applied
         *                          {string=} pURL - link to render
         *                          {string=} pID - (small) id text to render
         *                          {string=} pIDURL - link to render for the id text
         * @return {SVGElement}
         */
        createText: _createText,

        /**
         * Creates a text node with the given pText fitting diagonally (bottom-left
         *  - top right) in canvas pCanvas
         *
         * @param {string} pText
         * @param {object} pCanvas (an object with at least a .width and a .height)
         */
        createDiagonalText: function (pText, pCanvas, pClass){
            return domprimitives.setAttributes(
                _createText(pText, {x: pCanvas.width / 2, y: pCanvas.height / 2}, {class: pClass}),
                {
                    "transform":
                        "rotate(" +
                            round(geometry.getDiagonalAngle(pCanvas), PRECISION).toString() + " " +
                            round((pCanvas.width) / 2, PRECISION).toString() + " " +
                            round((pCanvas.height) / 2, PRECISION).toString() +
                        ")"
                }
            );
        },

        createSingleLine: function(pLine, pOptions) {
            return domprimitives.createElement(
                "line",
                {
                    x1: round(pLine.xFrom, PRECISION).toString(),
                    y1: round(pLine.yFrom, PRECISION).toString(),
                    x2: round(pLine.xTo, PRECISION).toString(),
                    y2: round(pLine.yTo, PRECISION).toString(),
                    class: pOptions ? pOptions.class : null
                }
            );
        },

        /**
         * Creates an svg rectangle of width x height, with the top left
         * corner at coordinates (x, y). pRX and pRY define the amount of
         * rounding the corners of the rectangle get; when they're left out
         * the function will render the corners as straight.
         *
         * Unit: pixels
         *
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @param {number=} pRX
         * @param {number=} pRY
         * @return {SVGElement}
         */
        createRect: function (pBBox, pOptions) {
            var lOptions = _.defaults(
                pOptions,
                {
                    class: null,
                    color: null,
                    bgColor: null,
                    rx: null,
                    ry: null
                }
            );
            return colorBox(
                domprimitives.createElement(
                    "rect",
                    {
                        width: round(pBBox.width, PRECISION),
                        height: round(pBBox.height, PRECISION),
                        x: round(pBBox.x, PRECISION),
                        y: round(pBBox.y, PRECISION),
                        rx: round(lOptions.rx, PRECISION),
                        ry: round(lOptions.ry, PRECISION),
                        class: lOptions.class
                    }
                ),
                lOptions.color,
                lOptions.bgColor
            );
        },

        /**
         * Creates a u-turn, departing on pPoint.x, pPoint.y and
         * ending on pPoint.x, pEndY with a width of pWidth
         *
         * @param {object} pPoint
         * @param {number} pEndY
         * @param {number} pWidth
         * @param {string} pClass - reference to the css class to be applied
         * @return {SVGElement}
         */
        createUTurn: function (pPoint, pEndY, pWidth, pClass, pOptions, pHeight) {
            var lOptions = _.defaults(
                pOptions,
                {
                    dontHitHome: false,
                    lineWidth: 1
                }
            );

            var lEndX = lOptions.dontHitHome ? pPoint.x + 7.5 * pOptions.lineWidth : pPoint.x;

            return createPath(
                // point to start from:
                pathPoint2String("M", pPoint.x, pPoint.y - (pHeight / 2)) +
                // curve first to:
                pathPoint2String("C", pPoint.x + pWidth, pPoint.y - ((7.5 * pOptions.lineWidth) / 2)) +
                // curve back from.:
                point2String(pPoint.x + pWidth, pEndY + 0) +
                // curve end-pont:
                point2String(lEndX, pEndY),
                {class: pClass}
            );
        },

        /**
         * Creates an svg group, identifiable with id pId
         * @param {string} pId
         * @return {SVGElement}
         */
        createGroup: function (pId, pClass) {
            return domprimitives.createElement(
                "g",
                {
                    id: pId,
                    class: pClass
                }
            );
        },

        /**
         * Creates an svg use for the SVGElement identified by pLink at coordinates pX, pY
         * @param {object} pCoords
         * @param {number} pLink
         * @return {SVGElement}
         */
        createUse: function (pCoords, pLink) {
            var lUse = domprimitives.createElement(
                "use",
                {
                    x: round(pCoords.x, PRECISION).toString(),
                    y: round(pCoords.y, PRECISION).toString()
                }
            );
            lUse.setAttributeNS(domprimitives.XLINKNS, "xlink:href", "#" + pLink);
            return lUse;
        },

        // elementfactory, wobbly, straight
        createPath       : createPath,

        /**
         * Create an arrow marker consisting of a path as specified in pD
         *
         * @param {string} pId
         * @param {string} pD - a string containing the path
         */
        createMarkerPath: function (pId, pD, pColor) {
            var lMarker = _createMarker(pId, "arrow-marker", "auto");
            /* stroke-dasharray: 'none' should work to override any dashes (like in
             * return messages (a >> b;)) and making sure the marker end gets
             * lines
             * This, however, does not work in webkit, hence the curious
             * value for the stroke-dasharray
             */
            lMarker.appendChild(
                createPath(
                    pD,
                    {
                        class: "arrow-style",
                        style: "stroke-dasharray:100,1;stroke:" + pColor || "black"
                    }
                )
            );
            return lMarker;
        },

        /**
         * Create a (filled) arrow marker consisting of a polygon as specified in pPoints
         *
         * @param {string} pId
         * @param {string} pPoints - a string with the points of the polygon
         * @return {SVGElement}
         */
        createMarkerPolygon: function (pId, pPoints, pColor) {
            var lMarker = _createMarker(pId, "arrow-marker", "auto");
            lMarker.appendChild(
                domprimitives.createElement(
                    "polygon",
                    {
                        points : pPoints,
                        class  : "arrow-style",
                        stroke : pColor || "black",
                        fill   : pColor || "black"
                    }
                )
            );
            return lMarker;
        },

        createTitle: function(pText){
            var lTitle = domprimitives.createElement('title');
            var lText = domprimitives.createTextNode(pText);
            lTitle.appendChild(lText);
            return lTitle;
        },

        // elementfactory, wobbly
        point2String     : point2String,

        // elementfactory, wobbly, straight
        pathPoint2String : pathPoint2String
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/variationhelpers',[],function() {
    "use strict";

    function determineStartCorrection(pLine, pClass, pLineWidth){
        var lRetval = 0;
        if (pClass.indexOf("nodi") < 0){
            if (pClass.indexOf("bidi") > -1) {
                if (pLine.xTo > pLine.xFrom){
                    lRetval = 7.5 * pLineWidth;
                } else {
                    lRetval = -7.5 * pLineWidth;
                }
            }
        }
        return lRetval;
    }

    function determineEndCorrection(pLine, pClass, pLineWidth){
        var lRetval = 0;
        if (pClass.indexOf("nodi") < 0){
            lRetval = pLine.xTo > pLine.xFrom ? -7.5 * pLineWidth : 7.5 * pLineWidth;
        }
        return lRetval;
    }

    function getLineLength(pLine) {
        var lA = Math.abs(pLine.xTo - pLine.xFrom);
        var lB = Math.abs(pLine.yTo - pLine.yFrom);

        return Math.sqrt((lA * lA) + (lB * lB));
    }

    function getNumberOfSegments(pLine, pInterval){
        var lLineLength = getLineLength(pLine);
        return lLineLength > 0 ? Math.floor(lLineLength / pInterval) : 0;
    }

    function getDirection(pLine){
        var lSignX = pLine.xTo > pLine.xFrom ? 1 : -1;
        return {
            signX: lSignX,
            signY: pLine.yTo > pLine.yFrom ? 1 : -1,
            dy: lSignX * (pLine.yTo - pLine.yFrom) / (pLine.xTo - pLine.xFrom)
        };
    }

    /**
     * Returns a random (real) number between -pNumber and +pNumber (inclusive)
     *
     * @param  {number} pNumber a real
     * @return {number}
     */
    function getRandomDeviation(pNumber) {
        return Math.round(Math.random() * 2 * pNumber) - pNumber;
    }

    function round(pNumber) {
        return Math.round(pNumber * 100) / 100;
    }

    function getBetweenPoints(pLine, pInterval, pWobble) {
        if (pInterval <= 0) {
            throw new Error("pInterval must be > 0");
        }
        pInterval = Math.min(getLineLength(pLine), pInterval);

        var lRetval     = [];
        var lNoSegments = getNumberOfSegments(pLine, pInterval);
        var lDir        = getDirection(pLine);
        var lIntervalX  = lDir.signX * Math.sqrt((Math.pow(pInterval, 2)) / (1 + Math.pow(lDir.dy, 2)));
        var lIntervalY  = lDir.signY * (Math.abs(lDir.dy) === Infinity
            ? pInterval
            : Math.sqrt((Math.pow(lDir.dy, 2) * Math.pow(pInterval, 2)) / (1 + Math.pow(lDir.dy, 2))));
        var lCurveSection = {};

        for (var i = 1; i <= lNoSegments; i++) {
            lCurveSection = {
                controlX : round(pLine.xFrom + (i - 0.5) * lIntervalX + getRandomDeviation(pWobble)),
                controlY : round(pLine.yFrom + (i - 0.5) * lIntervalY + getRandomDeviation(pWobble)),
                x        : round(pLine.xFrom + i * lIntervalX),
                y        : round(pLine.yFrom + i * lIntervalY)
            };
            if (pInterval >
                getLineLength({
                    xFrom: lCurveSection.x,
                    yFrom: lCurveSection.y,
                    xTo: pLine.xTo,
                    yTo: pLine.yTo
                })
            ){
                lCurveSection.x = pLine.xTo;
                lCurveSection.y = pLine.yTo;
            }
            lRetval.push(lCurveSection);
        }
        return lRetval;
    }

    return {
        // wobbly and internal for wobbly only functions
        round: round,

        determineStartCorrection: determineStartCorrection,
        determineEndCorrection: determineEndCorrection,

        /**
         * returns the angle (in radials) of the line
         *
         * @param {object} pLine - (xFrom,yFrom, xTo, YTo quadruple)
         * @return {object} the angle of the line in an object:
         *                      signX: the x direction (1 or -1)
         *                      signY: the y direction (1 or -1)
         *                      dy: the angle (in radials)
         */
        // straight, wobbly
        getDirection: getDirection,

        /**
         * Calculates the length of the given line
         * @param  {object} pLine an object with xFrom, yFrom and xTo and yTo
         *                        as properties
         * @return {number}       The length
         */
        // internal exposed for unit testing
        getLineLength: getLineLength,

        /**
         * Calculates the number of times a segment of pInterval length
         * can fit into pLine
         *
         * @param  {object} pLine     an object with xFrom, yFrom, and xTo and yTo
         * @param  {number} pInterval the length of the segments to fit into the
         *                            line
         * @return {number}           a natural number
         */
        // internal exposed for unit testing
        getNumberOfSegments: getNumberOfSegments,

        /**
         * returns an array of curvepoints (x,y, controlX, controlY) along pLine,
         * at pInterval length intervals. The pWobble parameter influences the
         * amount controlX and controlY can at most deviate from the pLine.
         *
         *
         * @param  {object} pLine     a line (an object with xFrom, yFrom,
         *                            xTo, yTo properties)
         * @param  {number} pInterval The length of the interval between two
         *                            points on the line. Must be > 0. The
         *                            function throws an error in other cases
         * @param  {number} pWobble   The maximum amount of deviation allowed for
         *                            control points
         * @return {array}
         */
        // wobbly
        getBetweenPoints: getBetweenPoints
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/straight',['require','./svgprimitives','./variationhelpers','../../../lib/lodash/lodash.custom'],function(require) {
    var svgprimitives    = require("./svgprimitives");
    var variationhelpers = require("./variationhelpers");
    var _                = require("../../../lib/lodash/lodash.custom");

    function createDoubleLine(pLine, pOptions) {
        var lLineWidth = pOptions.lineWidth || 1;
        var lSpace = lLineWidth;
        var lClass = pOptions ? pOptions.class : null;

        var lDir = variationhelpers.getDirection(pLine);
        var lEndCorr = variationhelpers.determineEndCorrection(pLine, lClass, lLineWidth);
        var lStartCorr = variationhelpers.determineStartCorrection(pLine, lClass, lLineWidth);

        var lLenX = (pLine.xTo - pLine.xFrom + lEndCorr - lStartCorr).toString();
        var lLenY = (pLine.yTo - pLine.yFrom).toString();
        var lStubble = svgprimitives.pathPoint2String("l", lDir.signX, lDir.dy);
        var lLine = svgprimitives.pathPoint2String("l", lLenX, lLenY);

        return svgprimitives.createPath(
            svgprimitives.pathPoint2String("M", pLine.xFrom, (pLine.yFrom - 7.5 * lLineWidth * lDir.dy)) +
            // left stubble:
            lStubble +
            svgprimitives.pathPoint2String("M", pLine.xFrom + lStartCorr, pLine.yFrom - lSpace) +
            // upper line:
            lLine +
            svgprimitives.pathPoint2String("M", pLine.xFrom + lStartCorr, pLine.yFrom + lSpace) +
            // lower line
            lLine +
            svgprimitives.pathPoint2String("M", pLine.xTo - lDir.signX, pLine.yTo + 7.5 * lLineWidth * lDir.dy) +
            // right stubble
            lStubble,
            pOptions
        );
    }

    /**
     * Creates a note of pWidth x pHeight, with the top left corner
     * at coordinates (pX, pY). pFoldSize controls the size of the
     * fold in the top right corner.
     * @param {object} pBBox
     * @param {string} pClass - reference to the css class to be applied
     * @param {number=} [pFoldSize=9]
     *
     * @return {SVGElement}
     */
    function createNote(pBBox, pOptions) {
        var lLineWidth = pOptions ? pOptions.lineWidth || 1 : 1;

        var lFoldSizeN = Math.max(9, Math.min(4.5 * lLineWidth, pBBox.height / 2));
        var lFoldSize = lFoldSizeN.toString(10);

        return svgprimitives.createPath(
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y) +
            // top line:
            svgprimitives.pathPoint2String("l", pBBox.width - lFoldSizeN, 0) +
            // fold:
            // we lift the pen of the paper here to make sure the fold
            // gets the fill color as well when such is specified
            svgprimitives.pathPoint2String("l", 0, lFoldSize) +
            svgprimitives.pathPoint2String("l", lFoldSize, 0) +
            svgprimitives.pathPoint2String("m", -lFoldSize, -lFoldSize) +
            svgprimitives.pathPoint2String("l", lFoldSize, lFoldSize) +
            // down:
            svgprimitives.pathPoint2String("l", 0, pBBox.height - lFoldSizeN) +
            // bottom line:
            svgprimitives.pathPoint2String("l", -(pBBox.width), 0) +
            svgprimitives.pathPoint2String("l", 0, -(pBBox.height)) +
            // because we lifted the pen from the paper in the fold (see
            // the m over there) - svg interpreters consider that to be
            // the start of the path. So, although we're already 'home'
            // visually we need to do one step extra.
            // If we don't we end up with a little gap on the top left
            // corner when our stroke-linecap===butt
            "z",
            pOptions
        );
    }

    /**
     * Creates rect with 6px rounded corners of width x height, with the top
     * left corner at coordinates (x, y)
     *
     * @param {object} pBBox
     * @param {string} pClass - reference to the css class to be applied
     * @return {SVGElement}
     */
    function createRBox (pBBox, pOptions) {
        var RBOX_CORNER_RADIUS = 6; // px
        pOptions.rx = RBOX_CORNER_RADIUS;
        pOptions.ry = RBOX_CORNER_RADIUS;

        return svgprimitives.createRect(pBBox, pOptions);
    }

    /**
     * Creates an angled box of width x height, with the top left corner
     * at coordinates (x, y)
     *
     * @param {object} pBBox
     * @param {string} pClass - reference to the css class to be applied
     * @return {SVGElement}
     */
    function createABox(pBBox, pOptions) {
        var lSlopeOffset = 3;
        return svgprimitives.createPath(
            // start
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y + (pBBox.height / 2)) +
            svgprimitives.pathPoint2String("l", lSlopeOffset, -(pBBox.height / 2)) +
            // top line
            svgprimitives.pathPoint2String("l", pBBox.width - 2 * lSlopeOffset, 0) +
            // right wedge
            svgprimitives.pathPoint2String("l", lSlopeOffset, pBBox.height / 2) +
            svgprimitives.pathPoint2String("l", -lSlopeOffset, pBBox.height / 2) +
            // bottom line:
            svgprimitives.pathPoint2String("l", -(pBBox.width - 2 * lSlopeOffset), 0) +
            "z",
            pOptions
        );
    }

    /**
     * Creates an edge remark (for use in inline expressions) of width x height,
     * with the top left corner at coordinates (x, y). pFoldSize controls the size of the
     * fold bottom right corner.
     * @param {object} pBBox
     * @param {string} pClass - reference to the css class to be applied
     * @param {number=} [pFoldSize=7]
     *
     * @return {SVGElement}
     */
    function createEdgeRemark(pBBox, pOptions) {
        var lFoldSize = pOptions && pOptions.foldSize ? pOptions.foldSize : 7;
        var lOptions = _.defaults(
            pOptions,
            {
                class: null,
                color: null,
                bgColor: null
            }
        );

        return svgprimitives.createPath(
            // start:
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y) +
            // top line:
            svgprimitives.pathPoint2String("l", pBBox.width, 0) +
            // down:
            svgprimitives.pathPoint2String("l", 0, pBBox.height - lFoldSize) +
            // fold:
            svgprimitives.pathPoint2String("l", -lFoldSize, lFoldSize) +
            // bottom line:
            svgprimitives.pathPoint2String("l", -(pBBox.width - lFoldSize), 0),
            lOptions
        );
    }
    return {
        createSingleLine: svgprimitives.createSingleLine,
        createDoubleLine: createDoubleLine,
        createNote: createNote,
        createRect: svgprimitives.createRect,
        createABox: createABox,
        createRBox: createRBox,
        createEdgeRemark: createEdgeRemark,

        createDesc: svgprimitives.createDesc,
        createDefs: svgprimitives.createDefs,
        createDiagonalText: svgprimitives.createDiagonalText,
        createTSpan: svgprimitives.createTSpan,
        createText: svgprimitives.createText,
        createUTurn: svgprimitives.createUTurn,
        createGroup: svgprimitives.createGroup,
        createUse: svgprimitives.createUse,
        createMarkerPath: svgprimitives.createMarkerPath,
        createMarkerPolygon: svgprimitives.createMarkerPolygon,
        createTitle: svgprimitives.createTitle,
        createSVG: svgprimitives.createSVG,
        updateSVG: svgprimitives.updateSVG,
        init: svgprimitives.init
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/wobbly',['require','./svgprimitives','./variationhelpers'],function(require) {

    var svgprimitives    = require("./svgprimitives");
    var variationhelpers = require("./variationhelpers");

    var SEGMENT_LENGTH = 70; // 70
    var WOBBLE_FACTOR  = 3; // 1.4?

    function points2CurveString(pPoints) {
        return pPoints.map(function(pThisPoint){
            return svgprimitives.pathPoint2String("S", pThisPoint.controlX, pThisPoint.controlY) +
                    " " + svgprimitives.point2String(pThisPoint.x, pThisPoint.y);
        }).join(" ");

    }

    function createSingleLine(pLine, pOptions) {
        var lDir = variationhelpers.getDirection(pLine);

        return svgprimitives.createPath(
            svgprimitives.pathPoint2String("M", pLine.xFrom, pLine.yFrom) +
            // Workaround; gecko and webkit treat markers slapped on the
            // start of a path with 'auto' different from each other when
            // there's not a line at the start and the path is not going
            // from exactly left to right (gecko renders the marker
            // correctly, whereas webkit will ignore auto and show the
            // marker in its default position)
            //
            // Adding a little stubble at the start of the line solves
            // all that.
            svgprimitives.pathPoint2String(
                "L",
                variationhelpers.round(pLine.xFrom + lDir.signX * Math.sqrt(1 / (1 + Math.pow(lDir.dy, 2)))),
                pLine.yFrom + lDir.signY * (Math.abs(lDir.dy) === Infinity
                    ? 1
                    : variationhelpers.round(Math.sqrt((Math.pow(lDir.dy, 2)) / (1 + Math.pow(lDir.dy, 2)))))
            ) +
            points2CurveString(
                variationhelpers.getBetweenPoints(
                    pLine,
                    SEGMENT_LENGTH,
                    WOBBLE_FACTOR
                )
            ),
            {
                class: pOptions ? pOptions.class : null
            }
        );
    }

    function renderNotePathString(pBBox, pFoldSize) {
        return svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y) +
            // top line:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width - pFoldSize,
                    yTo: pBBox.y
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width - pFoldSize, pBBox.y) +

            // fold:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - pFoldSize,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pFoldSize
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pFoldSize) +

            // down:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y + pFoldSize,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height) +

            // bottom line:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x, pBBox.y + pBBox.height) +

            // home:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x,
                    yTo: pBBox.y
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x, pBBox.y) +
            "z";
    }

    function renderNoteCornerString(pBBox, pFoldSize) {
        return svgprimitives.pathPoint2String("M", pBBox.x + pBBox.width - pFoldSize, pBBox.y) +
            // down
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - pFoldSize,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width - pFoldSize,
                    yTo: pBBox.y + pFoldSize
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width - pFoldSize, pBBox.y + pFoldSize) +
            // right
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - pFoldSize,
                    yFrom: pBBox.y + pFoldSize,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pFoldSize
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pFoldSize);
    }

    function createNote(pBBox, pOptions) {
        var lLineWidth = pOptions ? pOptions.lineWidth || 1 : 1;
        var lFoldSize = Math.max(9, Math.min(4.5 * lLineWidth, pBBox.height / 2));
        var lGroup = svgprimitives.createGroup();

        lGroup.appendChild(svgprimitives.createPath(renderNotePathString(pBBox, lFoldSize), pOptions));
        pOptions.bgColor = "transparent";
        lGroup.appendChild(svgprimitives.createPath(renderNoteCornerString(pBBox, lFoldSize), pOptions));
        return lGroup;
    }

    function renderRectString(pBBox) {
        if (!Boolean(pBBox.y)){
            pBBox.y = 0;
        }
        return svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y) +
        points2CurveString(
            variationhelpers.getBetweenPoints({
                xFrom: pBBox.x,
                yFrom: pBBox.y,
                xTo: pBBox.x + pBBox.width,
                yTo: pBBox.y
            }, SEGMENT_LENGTH, WOBBLE_FACTOR)
        ) +
        svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y) +
        points2CurveString(
            variationhelpers.getBetweenPoints({
                xFrom: pBBox.x + pBBox.width,
                yFrom: pBBox.y,
                xTo: pBBox.x + pBBox.width,
                yTo: pBBox.y + pBBox.height
            }, SEGMENT_LENGTH, WOBBLE_FACTOR)
        ) +
        svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height) +
        points2CurveString(
            variationhelpers.getBetweenPoints({
                xFrom: pBBox.x + pBBox.width,
                yFrom: pBBox.y + pBBox.height,
                xTo: pBBox.x,
                yTo: pBBox.y + pBBox.height
            }, SEGMENT_LENGTH, WOBBLE_FACTOR)
        ) +
        svgprimitives.pathPoint2String("L", pBBox.x, pBBox.y + pBBox.height) +
        points2CurveString(
            variationhelpers.getBetweenPoints({
                xFrom: pBBox.x,
                yFrom: pBBox.y + pBBox.height,
                xTo: pBBox.x,
                yTo: pBBox.y
            }, SEGMENT_LENGTH, WOBBLE_FACTOR)
        ) +
        "z";
    }

    function createRect(pBBox, pOptions) {
        return svgprimitives.createPath(
            renderRectString(pBBox, pOptions),
            pOptions
        );
    }

    function createABox(pBBox, pOptions) {
        var lSlopeOffset = 3;
        return svgprimitives.createPath(
            // start
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y + (pBBox.height / 2)) +
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x,
                    yFrom: pBBox.y + (pBBox.height / 2),
                    xTo: pBBox.x + lSlopeOffset,
                    yTo: pBBox.y
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + lSlopeOffset, pBBox.y) +
            // top line
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + lSlopeOffset,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width - lSlopeOffset,
                    yTo: pBBox.y
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width - lSlopeOffset, pBBox.y) +
            // right wedge
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - lSlopeOffset,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pBBox.height / 2
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height / 2) +
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y + pBBox.height / 2,
                    xTo: pBBox.x + pBBox.width - lSlopeOffset,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width - lSlopeOffset, pBBox.y + pBBox.height) +
            // bottom line:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - lSlopeOffset,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x + lSlopeOffset,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + lSlopeOffset, pBBox.y + pBBox.height) +
            // home:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + lSlopeOffset,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x,
                    yTo: pBBox.y + (pBBox.height / 2)
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            "z",
            pOptions
        );
    }

    function createRBox(pBBox, pOptions) {
        var RBOX_CORNER_RADIUS = 6; // px

        return svgprimitives.createPath(
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y + RBOX_CORNER_RADIUS) +
            points2CurveString([{
                controlX: pBBox.x,
                controlY: pBBox.y,
                x: pBBox.x + RBOX_CORNER_RADIUS,
                y: pBBox.y
            }]) +

            // top
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + RBOX_CORNER_RADIUS,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width - RBOX_CORNER_RADIUS,
                    yTo: pBBox.y
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width - RBOX_CORNER_RADIUS, pBBox.y) +

            points2CurveString([{
                controlX: pBBox.x + pBBox.width,
                controlY: pBBox.y,
                x: pBBox.x + pBBox.width,
                y: pBBox.y + RBOX_CORNER_RADIUS
            }]) +

            // right
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y + RBOX_CORNER_RADIUS,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pBBox.height - RBOX_CORNER_RADIUS
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height - RBOX_CORNER_RADIUS) +
            points2CurveString([{
                controlX: pBBox.x + pBBox.width,
                controlY: pBBox.y + pBBox.height,
                x: pBBox.x + pBBox.width - RBOX_CORNER_RADIUS,
                y: pBBox.y + pBBox.height
            }]) +

            // bottom
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - RBOX_CORNER_RADIUS,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x + RBOX_CORNER_RADIUS,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +

            svgprimitives.pathPoint2String("L", pBBox.x + RBOX_CORNER_RADIUS, pBBox.y + pBBox.height) +
            points2CurveString([{
                controlX: pBBox.x,
                controlY: pBBox.y + pBBox.height,
                x: pBBox.x,
                y: pBBox.y + pBBox.height - RBOX_CORNER_RADIUS
            }]) +

            // up
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x,
                    yFrom: pBBox.y + pBBox.height - RBOX_CORNER_RADIUS,
                    xTo: pBBox.x,
                    yTo: pBBox.y + RBOX_CORNER_RADIUS
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            "z",
            pOptions
        );
    }

    function createEdgeRemark (pBBox, pOptions) {
        var lLineWidth = pOptions ? pOptions.lineWidth || 1 : 1;
        var lGroup = svgprimitives.createGroup();

        var lFoldSize = pOptions && pOptions.foldSize ? pOptions.foldSize : 7;
        var lLineColor = pOptions && pOptions.color ? pOptions.color : "black";

        pOptions.color = "transparent!important"; /* :blush: */
        var lBackground = svgprimitives.createPath(
            // start:
            svgprimitives.pathPoint2String("M", pBBox.x, pBBox.y + (lLineWidth / 2)) +
            // top line:
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + (lLineWidth / 2)) +
            // down:
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height - lFoldSize) +
            // fold:
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width  - lFoldSize, pBBox.y + pBBox.height) +
            // bottom line:
            svgprimitives.pathPoint2String("L", pBBox.x, pBBox.y + pBBox.height) +
            "z",
            pOptions
        );

        pOptions.bgColor = "transparent";
        pOptions.color = lLineColor;
        var lLine = svgprimitives.createPath(
            // start:
            svgprimitives.pathPoint2String("M", pBBox.x + pBBox.width, pBBox.y) +
            // down:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y,
                    xTo: pBBox.x + pBBox.width,
                    yTo: pBBox.y + pBBox.height - lFoldSize
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width, pBBox.y + pBBox.height - lFoldSize) +
            // fold:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width,
                    yFrom: pBBox.y + pBBox.height - lFoldSize,
                    xTo: pBBox.x + pBBox.width - lFoldSize,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x + pBBox.width  - lFoldSize, pBBox.y + pBBox.height) +
            // bottom line:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pBBox.x + pBBox.width - lFoldSize,
                    yFrom: pBBox.y + pBBox.height,
                    xTo: pBBox.x - 1,
                    yTo: pBBox.y + pBBox.height
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("L", pBBox.x - 1, pBBox.y + pBBox.height),
            pOptions
        );
        lGroup.appendChild(lBackground);
        lGroup.appendChild(lLine);
        return lGroup;
    }

    function createDoubleLine(pLine, pOptions) {
        var lLineWidth = pOptions.lineWidth || 1;
        var lSpace = lLineWidth;
        var lClass = pOptions ? pOptions.class : null;

        var lDir = variationhelpers.getDirection(pLine);
        var lEndCorr = variationhelpers.determineEndCorrection(pLine, lClass, lLineWidth);
        var lStartCorr = variationhelpers.determineStartCorrection(pLine, lClass, lLineWidth);

        return svgprimitives.createPath(
            svgprimitives.pathPoint2String("M", pLine.xFrom, (pLine.yFrom - 7.5 * lLineWidth * lDir.dy)) +
            // left stubble:
            svgprimitives.pathPoint2String("l", lDir.signX, lDir.dy) +
            svgprimitives.pathPoint2String("M", pLine.xFrom + lStartCorr, pLine.yFrom - lSpace) +
            // upper line:
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pLine.xFrom + lStartCorr,
                    yFrom: pLine.yFrom - lSpace,
                    xTo: pLine.xTo + lEndCorr,
                    yTo: pLine.yTo - lSpace
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("M", pLine.xFrom + lStartCorr, pLine.yFrom + lSpace) +
            // lower line
            points2CurveString(
                variationhelpers.getBetweenPoints({
                    xFrom: pLine.xFrom + lStartCorr,
                    yFrom: pLine.yFrom + lSpace,
                    xTo: pLine.xTo + lEndCorr,
                    yTo: pLine.yTo + lSpace
                }, SEGMENT_LENGTH, WOBBLE_FACTOR)
            ) +
            svgprimitives.pathPoint2String("M", pLine.xTo - lDir.signX, pLine.yTo + 7.5 * lLineWidth * lDir.dy) +
            // right stubble
            svgprimitives.pathPoint2String("l", lDir.signX, lDir.dy),
            lClass
        );
    }

    return {
        createSingleLine: createSingleLine,
        createDoubleLine: createDoubleLine,
        createNote: createNote,
        createRect: createRect,
        createABox: createABox,
        createRBox: createRBox,
        createEdgeRemark: createEdgeRemark,

        createDesc: svgprimitives.createDesc,
        createDefs: svgprimitives.createDefs,
        createDiagonalText: svgprimitives.createDiagonalText,
        createTSpan: svgprimitives.createTSpan,
        createText: svgprimitives.createText,
        createUTurn: svgprimitives.createUTurn,
        createGroup: svgprimitives.createGroup,
        createUse: svgprimitives.createUse,
        createMarkerPath: svgprimitives.createMarkerPath,
        createMarkerPolygon: svgprimitives.createMarkerPolygon,
        createTitle: svgprimitives.createTitle,
        createSVG: svgprimitives.createSVG,
        updateSVG: svgprimitives.updateSVG,
        init: svgprimitives.init
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgelementfactory/index',['require','./straight','./wobbly','../../../lib/lodash/lodash.custom'],function(require) {
    /**
     * Renders individual elements in sequence charts
     * @exports svgelementfactory
     * @author {@link https://github.com/sverweij | Sander Verweij}
     *
     * defines:
     *  defaults for
     *      slope offset on aboxes
     *      fold size on notes
     *      space to use between double lines
     */
    "use strict";

    var straight      = require("./straight");
    var wobbly        = require("./wobbly");
    var _             = require("../../../lib/lodash/lodash.custom");

    var gRenderMagic  = straight;
    var gOptions      = {};

    function determineRenderMagic(pRenderMagic) {
        if (!Boolean(pRenderMagic)) {
            return gRenderMagic;
        }
        if ("wobbly" === pRenderMagic){
            return wobbly;
        }
        return straight;
    }

    return {
        /**
         * Function to set the document to use. Introduced to enable use of the
         * rendering utilities under node.js (using the jsdom module)
         *
         * @param {document} pDocument
         */
        init: function(pDocument, pOptions) {
            gRenderMagic.init(pDocument);
            gOptions = _.defaults(
                pOptions,
                {
                    LINE_WIDTH: 2,
                    FONT_SIZE: 12
                }
            );
        },

        /**
         * Creates a basic SVG with id pId, and size 0x0
         * @param {string} pId
         * @return {Element} an SVG element
         */
        createSVG: function (pId, pClass, pRenderMagic) {
            gRenderMagic = determineRenderMagic(pRenderMagic);
            return gRenderMagic.createSVG(pId, pClass);

        },

        updateSVG: gRenderMagic.updateSVG,

        createTitle: gRenderMagic.createTitle,

        /**
         * Creates a desc element with id pId
         *
         * @param {string} pID
         * @returns {Element}
         */
        createDesc: gRenderMagic.createDesc,

        /**
         * Creates an empty 'defs' element
         *
         * @returns {Element}
         */
        createDefs: gRenderMagic.createDefs,

        /**
         * creates a tspan with label pLabel, optionally wrapped in a link
         * if the url pURL is passed
         *
         * @param  {string} pLabel
         * @param  {string} pURL
         * @return {element}
         */
        createTSpan: gRenderMagic.createTSpan,

        /**
         * Creates an svg rectangle of width x height, with the top left
         * corner at coordinates (x, y). pRX and pRY define the amount of
         * rounding the corners of the rectangle get; when they're left out
         * the function will render the corners as straight.
         *
         * Unit: pixels
         *
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @param {number=} pRX
         * @param {number=} pRY
         * @return {SVGElement}
         */
        createRect : function (pBBox, pClass, pColor, pBgColor) {
            return gRenderMagic.createRect(pBBox, {class: pClass, color: pColor, bgColor: pBgColor});
        },

        /**
         * Creates rect with 6px rounded corners of width x height, with the top
         * left corner at coordinates (x, y)
         *
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @return {SVGElement}
         */
        createRBox: function (pBBox, pClass, pColor, pBgColor) {
            return gRenderMagic.createRBox(pBBox, {class: pClass, color: pColor, bgColor: pBgColor});
        },

        /**
         * Creates an angled box of width x height, with the top left corner
         * at coordinates (x, y)
         *
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @return {SVGElement}
         */
        createABox: function (pBBox, pClass, pColor, pBgColor) {
            return gRenderMagic.createABox(pBBox, {class: pClass, color: pColor, bgColor: pBgColor});
        },

        /**
         * Creates a note of pWidth x pHeight, with the top left corner
         * at coordinates (pX, pY). pFoldSize controls the size of the
         * fold in the top right corner.
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @param {number=} [pFoldSize=9]
         *
         * @return {SVGElement}
         */
        createNote: function (pBBox, pClass, pColor, pBgColor) {
            return gRenderMagic.createNote(
                pBBox,
                {
                    class: pClass,
                    color: pColor,
                    bgColor: pBgColor,
                    lineWidth: gOptions.LINE_WIDTH
                }
            );
        },

        /**
         * Creates an edge remark (for use in inline expressions) of width x height,
         * with the top left corner at coordinates (x, y). pFoldSize controls the size of the
         * fold bottom right corner.
         * @param {object} pBBox
         * @param {string} pClass - reference to the css class to be applied
         * @param {number=} [pFoldSize=7]
         *
         * @return {SVGElement}
         */
        createEdgeRemark: function (pBBox, pClass, pColor, pBgColor, pFoldSize) {
            return gRenderMagic.createEdgeRemark(
                pBBox,
                {
                    class: pClass,
                    color: pColor,
                    bgColor: pBgColor,
                    foldSize: pFoldSize,
                    lineWidth: gOptions.LINE_WIDTH
                }
            );
        },

        /**
         * Creates a text node with the appropriate tspan & a elements on
         * position pCoords.
         *
         * @param {string} pLabel
         * @param {object} pCoords
         * @param {object} pOptions - options to influence rendering
         *                          {string} pClass - reference to the css class to be applied
         *                          {string=} pURL - link to render
         *                          {string=} pID - (small) id text to render
         *                          {string=} pIDURL - link to render for the id text
         * @return {SVGElement}
         */
        createText: gRenderMagic.createText,

        /**
         * Creates a text node with the given pText fitting diagonally (bottom-left
         *  - top right) in canvas pCanvas
         *
         * @param {string} pText
         * @param {object} pCanvas (an object with at least a .width and a .height)
         */
        createDiagonalText: gRenderMagic.createDiagonalText,

        /**
         * Creates a line between to coordinates
         * @param {object} pLine - an xFrom, yFrom and xTo, yTo pair describing a line
         * @param {object} pOptions - class: reference to the css class to be applied, lineWidth: line width to use
         * @param {boolean=} [pDouble=false] - render a double line
         * @return {SVGElement}
         */
        createLine: function (pLine, pOptions) {
            if (Boolean(pOptions) && Boolean(pOptions.doubleLine)) {
                if (!pOptions.lineWidth) {
                    pOptions.lineWidth = gOptions.LINE_WIDTH;
                }
                return gRenderMagic.createDoubleLine(pLine, pOptions);
            } else {
                return gRenderMagic.createSingleLine(pLine, pOptions);
            }
        },

        /**
         * Creates a u-turn, departing on pStartX, pStarty and
         * ending on pStartX, pEndY with a width of pWidth
         *
         * @param {object} pPoint
         * @param {number} pEndY
         * @param {number} pWidth
         * @param {string} pClass - reference to the css class to be applied
         * @return {SVGElement}
         */
        createUTurn: function (pPoint, pEndY, pWidth, pClass, pDontHitHome, pHeight) {
            return gRenderMagic.createUTurn(
                pPoint,
                pEndY,
                pWidth,
                pClass,
                {
                    dontHitHome: pDontHitHome,
                    lineWidth: gOptions.LINE_WIDTH
                },
                pHeight
            );
        },

        /**
         * Creates an svg group, identifiable with id pId
         * @param {string} pId
         * @return {SVGElement}
         */
        createGroup: gRenderMagic.createGroup,

        /**
         * Creates an svg use for the SVGElement identified by pLink at coordinates pX, pY
         * @param {object} pCoords
         * @param {number} pLink
         * @return {SVGElement}
         */
        createUse: gRenderMagic.createUse,

        /**
         * Create an arrow marker consisting of a path as specified in pD
         *
         * @param {string} pId
         * @param {string} pD - a string containing the path
         */
        createMarkerPath: gRenderMagic.createMarkerPath,

        /**
         * Create a (filled) arrow marker consisting of a polygon as specified in pPoints
         *
         * @param {string} pId
         * @param {string} pPoints - a string with the points of the polygon
         * @return {SVGElement}
         */
        createMarkerPolygon: gRenderMagic.createMarkerPolygon
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/idmanager',[],function() {
    "use strict";
    var INNERELEMENTPREFIX = "mscgenjs";

    var gInnerElementId = INNERELEMENTPREFIX;

    return {
        setPrefix: function (pPrefix){
            gInnerElementId = INNERELEMENTPREFIX + pPrefix;
        },
        get: function(pElementIdentifierString) {
            return gInnerElementId + (pElementIdentifierString || "");
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/svgutensils',['require','./idmanager','./svgelementfactory/index','../../lib/lodash/lodash.custom'],function(require) {
    "use strict";

    var idmanager         = require("./idmanager");
    var svgelementfactory = require("./svgelementfactory/index");
    var _                 = require("../../lib/lodash/lodash.custom");

    /**
     * Some SVG specific calculations & workarounds
     */

    var gDocument = {};
    var gSvgBBoxerId = idmanager.get("bboxer");

    /* istanbul ignore next */
    function _createBBoxerSVG(pId){
        var lSvg = svgelementfactory.createSVG(pId, idmanager.get());
        gDocument.body.appendChild(lSvg);

        return lSvg;
    }

    /* istanbul ignore next */
    function getNativeBBox(pElement){
        /* getNativeBBoxWithCache */
        var lSvg = gDocument.getElementById(gSvgBBoxerId);
        lSvg = lSvg ? lSvg : _createBBoxerSVG(gSvgBBoxerId);

        lSvg.appendChild(pElement);
        var lRetval = pElement.getBBox();
        lSvg.removeChild(pElement);

        return lRetval;
    }

    /*
     * workaround for Opera browser quirk: if the dimensions
     * of an element are 0x0, Opera's getBBox() implementation
     * returns -Infinity (which is a kind of impractical value
     * to actually render, even for Opera)
     * To counter this, manually set the return value to 0x0
     * if height or width has a wacky value:
     */
    /* istanbul ignore next */
    function sanitizeBBox(pBBox){
        var INSANELYBIG = 100000;

        if (Math.abs(pBBox.height) > INSANELYBIG || Math.abs(pBBox.width) > INSANELYBIG) {
            return {
                height : 0,
                width : 0,
                x : 0,
                y : 0
            };
        } else {
            return pBBox;
        }
    }

    function _getBBox(pElement) {
        /* istanbul ignore if */
        if (typeof (pElement.getBBox) === 'function') {
            return sanitizeBBox(getNativeBBox(pElement));
        } else {
            return {
                height : 15,
                width : 15,
                x : 2,
                y : 2
            };
        }
    }

    function _calculateTextHeight(){
        /* Uses a string with some characters that tend to stick out
         * above/ below the current line and an 'astral codepoint' to
         * determine the text height to use everywhere.
         *
         * The astral \uD83D\uDCA9 codepoint mainly makes a difference in gecko based
         * browsers. The string in readable form: ÁjyÎ9ƒ@💩
         */
        return _getBBox(
            svgelementfactory.createText(
                "\u00C1jy\u00CE9\u0192@\uD83D\uDCA9",
                {
                    x: 0,
                    y: 0
                }
            )
        ).height;
    }


    function _removeRenderedSVGFromElement(pElementId){
        idmanager.setPrefix(pElementId);
        var lChildElement = gDocument.getElementById(idmanager.get());
        if (Boolean(lChildElement)) {
            var lParentElement = gDocument.getElementById(pElementId);
            if (lParentElement) {
                lParentElement.removeChild(lChildElement);
            } else {
                gDocument.body.removeChild(lChildElement);
            }
        }
    }

    return {
        init: function(pDocument){
            gDocument = pDocument;
        },
        removeRenderedSVGFromElement : _removeRenderedSVGFromElement,

        /**
         * Returns the bounding box of the passed element.
         *
         * Note: to be able to calculate the actual bounding box of an element it has
         * to be in a DOM tree first. Hence this function temporarily creates the element,
         * calculates the bounding box and removes the temporarily created element again.
         *
         * @param {SVGElement} pElement - the element to calculate the bounding box for
         * @return {boundingbox} an object with properties height, width, x and y. If
         * the function cannot determine the bounding box  be determined, returns 15,15,2,2
         * as "reasonable default"
         */
        getBBox : _getBBox,

        /**
         * Returns the height in pixels necessary for rendering characters
         */
        calculateTextHeight: _.memoize(_calculateTextHeight),

        // webkit (at least in Safari Version 6.0.5 (8536.30.1) which is
        // distibuted with MacOSX 10.8.4) omits the xmlns: and xlink:
        // namespace prefixes in front of xlink and all hrefs respectively.
        // this function does a crude global replace to circumvent the
        // resulting problems. Problem happens for xhtml too
        webkitNamespaceBugWorkaround : function (pText){
            return pText.replace(/ xlink=/g, " xmlns:xlink=", "g")
                .replace(/ href=/g, " xlink:href=", "g");
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/renderutensils',['require','../../lib/lodash/lodash.custom'],function(require) {
    "use strict";

    var _ = require("../../lib/lodash/lodash.custom");

    return {
        scaleCanvasToWidth: function (pWidth, pCanvas) {
            var lCanvas = _.cloneDeep(pCanvas);

            lCanvas.scale = (pWidth / lCanvas.width);
            lCanvas.width *= lCanvas.scale;
            lCanvas.height *= lCanvas.scale;
            lCanvas.horizontaltransform *= lCanvas.scale;
            lCanvas.verticaltransform *= lCanvas.scale;
            lCanvas.x = 0 - lCanvas.horizontaltransform;
            lCanvas.y = 0 - lCanvas.verticaltransform;

            return lCanvas;
        },
        determineDepthCorrection: function (pDepth, pLineWidth){
            return pDepth ? 2 * ((pDepth + 1) * 2 * pLineWidth) : 0;
        },
        determineArcXTo: function (pKind, pFrom, pTo){
            if ("-x" === pKind) {
                return pFrom + (pTo - pFrom) * (3 / 4);
            } else {
                return pTo;
            }
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/constants',[],function() {
    "use strict";
    return {
        LINE_WIDTH: 2, // px
        FONT_SIZE: 12 // px
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/csstemplates',[],function() {
    "use strict";
    return {
        baseTemplate : "svg.<%=id%>{font-family:Helvetica,sans-serif;font-size:<%=fontSize%>px;font-weight:normal;font-style:normal;text-decoration:none;background-color:white;stroke:black;stroke-width:<%=lineWidth%>}.<%=id%> path, .<%=id%> rect{fill:none}.<%=id%> .label-text-background{fill:white;stroke:white;stroke-width:0}.<%=id%> .bglayer{fill:white;stroke:white;stroke-width:0}.<%=id%> line{}.<%=id%> .return, .<%=id%> .comment{stroke-dasharray:5,3}.<%=id%> .inline_expression_divider{stroke-dasharray:10,5}.<%=id%> text{color:inherit;stroke:none;text-anchor:middle}.<%=id%> text.anchor-start{text-anchor:start}.<%=id%> .arrow-marker{overflow:visible}.<%=id%> .arrow-style{stroke-width:1}.<%=id%> .arcrow, .<%=id%> .arcrowomit, .<%=id%> .emphasised{stroke-linecap:butt}.<%=id%> .arcrowomit{stroke-dasharray:2,2}.<%=id%> .box, .<%=id%> .entity{fill:white;stroke-linejoin:round}.<%=id%> .inherit{stroke:inherit;color:inherit}.<%=id%> .inherit-fill{fill:inherit}.<%=id%> .watermark{font-size:48pt;font-weight:bold;opacity:0.14}",
        namedStyles : [
    {
        "name": "basic",
        "description": "Basic",
        "experimental": false,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> text.entity-text{text-decoration:underline;}"
    },
    {
        "name": "lazy",
        "description": "Lazy",
        "experimental": false,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> text.entity-text{font-weight:bold;}.<%=id%> text.return-text{font-style:italic}.<%=id%> path.note{fill:#FFFFCC}.<%=id%> rect.label-text-background{opacity:0.9}.<%=id%> line.comment,.<%=id%> rect.inline_expression,.<%=id%> .inline_expression_divider,.<%=id%> .inline_expression_label{stroke:grey}"
    },
    {
        "name": "classic",
        "description": "Classic",
        "experimental": false,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> text.entity-text{text-decoration:none}.<%=id%> .entity{stroke:none;}.<%=id%> line,.<%=id%> rect,.<%=id%> path{stroke-width:1px}.<%=id%> .arrow-style{stroke-width:2;}.<%=id%> .inline_expression,.<%=id%> .inline_expression_divider,.<%=id%> .inline_expression_label{stroke-width: 1px}"
    },
    {
        "name": "fountainpen",
        "description": "Fountain pen",
        "experimental": true,
        "deprecated": false,
        "renderMagic": "wobbly",
        "cssBefore": "@import 'https://fonts.googleapis.com/css?family=Gochi+Hand';",
        "cssAfter": "svg.<%=id%>{font-family:'Gochi Hand', cursive;font-size:14px;stroke-opacity:0.4;stroke-linecap:round;background-color:transparent}.<%=id%> text{fill:rgba(0,0,128,0.7)}.<%=id%> marker polygon{fill:rgba(0,0,255,0.4);stroke-linejoin:round}.<%=id%> line, .<%=id%> path, .<%=id%> rect, .<%=id%> polygon{stroke:blue !important}.<%=id%> text.entity-text{font-weight:bold;text-decoration:none}.<%=id%> text.return-text{font-style:italic}.<%=id%> path.note{fill:#FFFFCC;}.<%=id%> .label-text-background{opacity:0}"
    },
    {
        "name": "cygne",
        "description": "Cygne (best with msgenny)",
        "experimental": true,
        "deprecated": true,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> line, .<%=id%> path{stroke:#00A1DE}.<%=id%> text{fill:#005B82}.<%=id%> .entity,.<%=id%> .box{fill:#00A1DE;stroke:#00A1DE}.<%=id%> text.box-text{fill:white}.<%=id%> text.entity-text{font-weight:bold;fill:white;text-decoration:none}.<%=id%> text.return-text{font-style:italic}.<%=id%> path.note{fill:#E77B2F;stroke:white}.<%=id%> .comment,.<%=id%> .inline_expression,.<%=id%> .inline_expression_divider,.<%=id%> .inline_expression_label{fill:white}"
    },
    {
        "name": "pegasse",
        "description": "Pégase (best with msgenny)",
        "experimental": false,
        "deprecated": true,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> line, .<%=id%> path{stroke:rgba(0, 43, 84, 1)}.<%=id%> text{fill:rgba(0, 43, 84, 1)}.<%=id%> .entity,.<%=id%> .box{fill:rgba(0, 43, 84, 1);stroke:rgba(0, 43, 84, 1)}.<%=id%> text.box-text{fill:white}.<%=id%> text.entity-text{font-weight:bold;fill:white;text-decoration:none}.<%=id%> text.return-text{font-style:italic}.<%=id%> path.note{fill:rgba(255, 50, 0, 1);stroke:white}.<%=id%> .comment,.<%=id%> .inline_expression,.<%=id%> .inline_expression_divider,.<%=id%> .inline_expression_label{fill:white}"
    },
    {
        "name": "grayscaled",
        "description": "Grayscaled (not in IE or Safari)",
        "experimental": true,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": "svg.<%=id%>{filter:grayscale(1);-webkit-filter:grayscale(1);}"
    },
    {
        "name": "inverted",
        "description": "Inverted (not in IE or Safari)",
        "experimental": true,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": "svg.<%=id%>{filter:invert(1);-webkit-filter:invert(1);}"
    },
    {
        "name": "noentityboxes",
        "description": "No entity boxes",
        "experimental": false,
        "deprecated": false,
        "renderMagic": "straight",
        "cssBefore": "",
        "cssAfter": ".<%=id%> .entity{fill:none;stroke:none;}.<%=id%> text.entity-text{text-decoration:underline;}"
    }
]
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/renderskeleton',['require','./svgelementfactory/index','./constants','./csstemplates'],function(require) {
    /**
     * sets up a skeleton svg, with the skeleton for rendering an msc ready
     *
     *  desc with id __msc_source - will contain the msc source
     *  defs
     *      a list of markers used as arrow heads (each with an own id)
     *      a stylesheet (without an id)
     *  __body - a stack of layers, from bottom to top:
     *      __background    -
     *      __arcspanlayer  - for inline expressions ("arc spanning arcs")
     *      __lifelinelayer - for the lifelines
     *      __sequencelayer - for arcs and associated text
     *      __notelayer     - for notes and boxes - the labels of arcspanning arcs
     *                        will go in here as well
     *      __watermark     - the watermark. Contra-intuitively this one
     *                        goes on top.
     * @exports renderskeleton
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */
    "use strict";

    var svgelementfactory = require("./svgelementfactory/index");
    var constants         = require("./constants");
    var csstemplates      = require("./csstemplates");

    var gDocument = {};

    function setupMarkers(pDefs, pMarkerDefs) {
        pMarkerDefs.forEach(function(pMarker){
            if (pMarker.type === "method"){
                pDefs.appendChild(svgelementfactory.createMarkerPolygon(pMarker.name, pMarker.path, pMarker.color));
            } else {
                pDefs.appendChild(svgelementfactory.createMarkerPath(pMarker.name, pMarker.path, pMarker.color));
            }
        });
        return pDefs;
    }

    function setupStyle(pOptions, pSvgElementId) {
        var lStyle = gDocument.createElement("style");
        lStyle.setAttribute("type", "text/css");
        lStyle.appendChild(
            gDocument.createTextNode(
                setupStyleElement(pOptions, pSvgElementId)
            )
        );
        return lStyle;
    }

    function setupDefs(pElementId, pMarkerDefs, pOptions) {
        /*
         * definitions - which will include style and markers
         */
        var lDefs = svgelementfactory.createDefs();
        lDefs.appendChild(setupStyle(pOptions, pElementId));
        lDefs = setupMarkers(lDefs, pMarkerDefs);
        return lDefs;
    }

    function setupBody(pElementId) {
        var lBody = svgelementfactory.createGroup(pElementId + "_body");

        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_background"));
        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_arcspans"));
        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_lifelines"));
        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_sequence"));
        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_notes"));
        lBody.appendChild(svgelementfactory.createGroup(pElementId + "_watermark"));
        return lBody;
    }

    function _init(pWindow) {
        svgelementfactory.init(
            pWindow.document,
            {
                LINE_WIDTH: constants.LINE_WIDTH,
                FONT_SIZE: constants.FONT_SIZE
            }

        );
        return pWindow.document;
    }

    function _bootstrap(pWindow, pParentElementId, pSvgElementId, pMarkerDefs, pOptions) {

        gDocument = _init(pWindow);

        var lParent = gDocument.getElementById(pParentElementId);
        if (lParent === null) {
            lParent = gDocument.body;
        }
        var lSkeletonSvg = svgelementfactory.createSVG(pSvgElementId, pSvgElementId, distillRenderMagic(pOptions));
        if (Boolean(pOptions.source)) {
            lSkeletonSvg.appendChild(setupDesc(pWindow, pOptions.source));
        }
        lSkeletonSvg.appendChild(setupDefs(pSvgElementId, pMarkerDefs, pOptions));
        lSkeletonSvg.appendChild(setupBody(pSvgElementId));
        lParent.appendChild(lSkeletonSvg);

        return gDocument;
    }

    function setupDesc(pWindow, pSource) {
        var lDesc = svgelementfactory.createDesc();
        lDesc.appendChild(pWindow.document.createTextNode(
            "\n\n# Generated by mscgen_js - https://sverweij.github.io/mscgen_js\n" + pSource
        ));
        return lDesc;
    }

    function findNamedStyle(pAdditionalTemplate) {
        var lRetval = null;
        var lNamedStyles = csstemplates.namedStyles.filter(
            function(tpl) {
                return tpl.name === pAdditionalTemplate;
            }
        );
        if (lNamedStyles.length > 0) {
            lRetval = lNamedStyles[0];
        }
        return lRetval;
    }

    function distillRenderMagic(pOptions) {
        var lRetval = "";
        var lNamedStyle  = {};

        /* istanbul ignore if */
        if (!Boolean(pOptions)) {
            return "";
        }

        if (Boolean(pOptions.additionalTemplate)) {
            lNamedStyle = findNamedStyle(pOptions.additionalTemplate);
            if (Boolean(lNamedStyle)){
                lRetval = lNamedStyle.renderMagic;
            }
        }

        return lRetval;
    }

    function distillCSS(pOptions, pPosition) {
        var lStyleString = "";
        var lNamedStyle  = {};

        /* istanbul ignore if */
        if (!Boolean(pOptions)) {
            return "";
        }

        if (Boolean(pOptions.additionalTemplate)) {
            lNamedStyle = findNamedStyle(pOptions.additionalTemplate);
            if (Boolean(lNamedStyle)){
                lStyleString = lNamedStyle[pPosition];
            }
        }

        return lStyleString;
    }

    function distillAfterCSS(pOptions) {
        var lStyleString = distillCSS(pOptions, "cssAfter");

        if (Boolean(pOptions.styleAdditions)) {
            lStyleString += pOptions.styleAdditions;
        }

        return lStyleString;
    }

    function distillBeforeCSS(pOptions) {
        return distillCSS(pOptions, "cssBefore");
    }

    function setupStyleElement(pOptions, pSvgElementId) {
        return (distillBeforeCSS(pOptions) + csstemplates.baseTemplate + distillAfterCSS(pOptions))
            .replace(/<%=fontSize%>/g, constants.FONT_SIZE)
            .replace(/<%=lineWidth%>/g, constants.LINE_WIDTH)
            .replace(/<%=id%>/g, pSvgElementId);

    }
    return {
        /**
         * Sets up a skeleton svg document with id pSvgElementId in the dom element
         * with id pParentElementId, both in window pWindow. See the module
         * documentation for details on the structure of the skeleton.
         *
         * @param {string} pParentElementId
         * @param {string} pSvgElementId
         * @param {object} pMarkerDefs
         * @param {string} pStyleAdditions
         * @param {window} pWindow
         * @param {options} pOptions
         *        source - the source code (string),
         *        additionalTemplate - string identifying a named style
         *
         */
        bootstrap : _bootstrap,

        /**
         * Initializes the document to the document associated with the
         * given pWindow and returns it.
         *
         * @param {window} pWindow
         * @return {document}
         */
        init : _init

    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/*
 * Transforms an AST using the given functions that
 * operate on entities, arcs and arc rows respectively
 */

/* istanbul ignore else */


define('lib/mscgenjs-core/render/astmassage/asttransform',[],function() {
    /**
     *
     * @exports node/asttransform
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */
    "use strict";

    function transformEntities(pEntities, pFunctionAry) {
        if (pEntities && pFunctionAry) {
            pEntities.forEach(function(pEntity) {
                pFunctionAry.forEach(function(pFunction) {
                    pFunction(pEntity);
                });
            });
        }
    }

    function transformArc(pEntities, pArcRow, pArc, pFunctionAry) {
        if (pFunctionAry) {
            pFunctionAry.forEach(function(pFunction) {
                pFunction(pArc, pEntities, pArcRow);
            });
        }
    }

    function transformArcRow(pEntities, pArcRow, pFunctionAry) {
        pArcRow.forEach(function(pArc){
            transformArc(pEntities, pArcRow, pArc, pFunctionAry);
            if (pArc.arcs) {
                transformArcRows(pEntities, pArc.arcs, pFunctionAry);
            }
        });
    }

    function transformArcRows(pEntities, pArcRows, pFunctionAry) {
        if (pEntities && pArcRows && pFunctionAry) {
            pArcRows.forEach(function(pArcRow) {
                transformArcRow(pEntities, pArcRow, pFunctionAry);
            });
        }
    }

    return {
        /**
         * Generic function for performing manipulations on abstract syntax trees. It takes a
         * series of functions as arguments and applies them to the entities, arcs and arc
         * rows in the syntax tree respectively.
         *
         * @param {ast} pAST - the syntax tree to transform
         * @param {Array} pEntityTransforms - an array of functions. Each function shall take
         * an entity as input an return the modified entity
         * @param {Array} pArcTransforms - an array of functions. Each function shall take
         * and arc and entities as input and return the modified arc
         * @param {Array} pArcRowTransforms - an array of functions. Each function shall take
         * an arc row and entities as input return the modified arc row
         * @return {ast} - the modified syntax tree
         */
        transform : function (pAST, pEnityTransforms, pArcTransforms) {
            transformEntities(pAST.entities, pEnityTransforms);
            transformArcRows(pAST.entities, pAST.arcs, pArcTransforms);
            return pAST;
        }
    };
});

/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/astmassage/aggregatekind',[],function() {
    "use strict";

    /**
     * Defines several mappings of arckinds to agregations
     *
     * @exports node/arcmappings
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */

    var KIND2AGGREGATE = {
        "|||" : "emptyarc",
        "..." : "emptyarc",
        "---" : "emptyarc",
        "->" : "directional",
        "=>" : "directional",
        "=>>" : "directional",
        ">>" : "directional",
        ":>" : "directional",
        "-x" : "directional",
        "<-" : "directional",
        "<=" : "directional",
        "<<=" : "directional",
        "<<" : "directional",
        "<:" : "directional",
        "x-" : "directional",
        "note" : "box",
        "box" : "box",
        "abox" : "box",
        "rbox" : "box",
        "<->" : "bidirectional",
        "<=>" : "bidirectional",
        "<<=>>" : "bidirectional",
        "<<>>" : "bidirectional",
        "<:>" : "bidirectional",
        "--" : "nondirectional",
        "==" : "nondirectional",
        ".." : "nondirectional",
        "::" : "nondirectional",
        "alt" : "inline_expression",
        "else" : "inline_expression",
        "opt" : "inline_expression",
        "break" : "inline_expression",
        "par" : "inline_expression",
        "seq" : "inline_expression",
        "strict" : "inline_expression",
        "neg" : "inline_expression",
        "critical" : "inline_expression",
        "ignore" : "inline_expression",
        "consider" : "inline_expression",
        "assert" : "inline_expression",
        "loop" : "inline_expression",
        "ref" : "inline_expression",
        "exc" : "inline_expression"
    };

    return {
        // all of em: graphics, massage, text (dot, doxygen, mscgen)
        getAggregate : function(pKey) { return KIND2AGGREGATE[pKey]; }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/astmassage/normalizekind',[],function() {
    "use strict";

    /**
     * Defines several mappings of arckinds to agregations
     *
     * @exports node/arcmappings
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */

    var KIND2NORMALIZEDKIND = {
        "<-" : "->",
        "<=" : "=>",
        "<<=" : "=>>",
        "<<" : ">>",
        "<:" : ":>",
        "x-" : "-x"
    };

    return {
        // graphics and flatten
        getNormalizedKind : function(pKey) { return KIND2NORMALIZEDKIND[pKey] || pKey; }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/astmassage/normalizeoptions',['require','../../lib/lodash/lodash.custom'],function(require) {
    "use strict";

    var _ = require("../../lib/lodash/lodash.custom");

    return function(pOptions) {
        return _.defaults(
            pOptions || {},
            {
                wordwraparcs     : false,
                wordwrapentities : true,
                wordwrapboxes    : true
            }
        );
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define(
/**
 * A hodge podge of functions manipulating text
 *
 * @exports node/textutensils
 * @author {@link https://github.com/sverweij | Sander Verweij}
 */
    'lib/mscgenjs-core/render/textutensils/escape',[],function() {
        "use strict";

        return {
        /**
         * takes pString and replaces all escaped double quotes with
         * regular double quotes
         * @param {string} pString
         * @return {string}
         */
            unescapeString : function(pString) {
                return pString.replace(/\\"/g, '"');
            },

            /**
         * takes pString and replaces all double quotes with
         * escaped double quotes
         * @param {string} pString
         * @return {string}
         */
            escapeString : function(pString) {
                return pString.replace(/\\"/g, "\"").replace(/"/g, "\\\"");
            }
        };
    });
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define(
/**
 * Defines some functions to simplify a given abstract syntax tree.
 *
 * @exports node/flatten
 * @author {@link https://github.com/sverweij | Sander Verweij}
 */
    'lib/mscgenjs-core/render/astmassage/flatten',['require','./asttransform','./aggregatekind','./normalizekind','./normalizeoptions','../../lib/lodash/lodash.custom','../textutensils/escape'],function(require) {
        "use strict";

        var asttransform     = require("./asttransform");
        var aggregatekind    = require("./aggregatekind");
        var normalizekind    = require("./normalizekind");
        var normalizeoptions = require("./normalizeoptions");
        var _                = require("../../lib/lodash/lodash.custom");
        var escape           = require("../textutensils/escape");

        var gMaxDepth = 0;

        function nameAsLabel(pEntity) {
            if (typeof pEntity.label === 'undefined') {
                pEntity.label = pEntity.name;
            }
        }

        function unescapeLabels(pArcOrEntity){
            if (Boolean(pArcOrEntity.label)) {
                pArcOrEntity.label = escape.unescapeString(pArcOrEntity.label);
            }
            if (Boolean(pArcOrEntity.id)){
                pArcOrEntity.id = escape.unescapeString(pArcOrEntity.id);
            }
        }

        function emptyStringForNoLabel(pArc){
            pArc.label = Boolean(pArc.label) ? pArc.label : "";
        }

        function _swapRTLArc(pArc) {
            if (pArc.kind && (normalizekind.getNormalizedKind(pArc.kind) !== pArc.kind)) {
                pArc.kind = normalizekind.getNormalizedKind(pArc.kind);

                var lTmp = pArc.from;
                pArc.from = pArc.to;
                pArc.to = lTmp;
            }
            return pArc;
        }

        function overrideColorsFromThing(pArc, pThing) {
            if (!(pArc.linecolor) && pThing.arclinecolor) {
                pArc.linecolor = pThing.arclinecolor;
            }
            if (!(pArc.textcolor) && pThing.arctextcolor) {
                pArc.textcolor = pThing.arctextcolor;
            }
            if (!(pArc.textbgcolor) && pThing.arctextbgcolor) {
                pArc.textbgcolor = pThing.arctextbgcolor;
            }
        }

        /*
     * assumes arc direction to be either LTR, both, or none
     * so arc.from exists.
     */
        function overrideColors(pArc, pEntities) {
            if (pArc && pArc.from) {
                var lMatchingEntities = pEntities.filter(function(pEntity){
                    return pEntity.name === pArc.from;
                });
                if (lMatchingEntities.length > 0) {
                    overrideColorsFromThing(pArc, lMatchingEntities[0]);
                }
            }
        }
        function calcNumberOfRows(pInlineExpression) {
            return pInlineExpression.arcs.reduce(function(pSum, pArc){
                return pSum + (Boolean(pArc[0].arcs) ? calcNumberOfRows(pArc[0]) + 1 : 0);
            }, pInlineExpression.arcs.length);
        }

        function unwindArcRow(pArcRow, pDepth, pFrom, pTo) {
            var lRetval = [];
            var lArcRowToPush = [];
            var lUnWoundSubArcs = [];

            pArcRow.forEach(
                function(pArc){
                    if ("inline_expression" === aggregatekind.getAggregate(pArc.kind)) {
                        pArc.depth = pDepth;
                        if (Boolean(pArc.arcs)) {
                            var lInlineExpression = _.cloneDeep(pArc);
                            lInlineExpression.numberofrows = calcNumberOfRows(lInlineExpression);
                            delete lInlineExpression.arcs;
                            lArcRowToPush.push(lInlineExpression);

                            pArc.arcs.forEach(
                                function(pSubArcRow) {
                                    lUnWoundSubArcs = lUnWoundSubArcs.concat(
                                        unwindArcRow(
                                            pSubArcRow,
                                            pDepth + 1,
                                            lInlineExpression.from,
                                            lInlineExpression.to
                                        )
                                    );
                                    pSubArcRow.forEach(function(pSubArc) {
                                        overrideColorsFromThing(pSubArc, lInlineExpression);
                                    });
                                }
                            );
                            if (pDepth > gMaxDepth) {
                                gMaxDepth = pDepth;
                            }
                        } else {
                            lArcRowToPush.push(pArc);
                        }
                        lUnWoundSubArcs.push([{
                            kind : "|||",
                            from : pArc.from,
                            to : pArc.to
                        }]);
                    } else {
                        if ((pFrom && pTo) && ("emptyarc" === aggregatekind.getAggregate(pArc.kind))) {
                            pArc.from = pFrom;
                            pArc.to = pTo;
                            pArc.depth = pDepth;
                        }
                        lArcRowToPush.push(pArc);
                    }
                }
            );
            lRetval.push(lArcRowToPush);
            return lRetval.concat(lUnWoundSubArcs);
        }

        function _unwind(pAST) {
            var lAST = {};
            gMaxDepth = 0;

            if (Boolean(pAST.options)){
                lAST.options = _.cloneDeep(pAST.options);
            }
            if (Boolean(pAST.entities)){
                lAST.entities = _.cloneDeep(pAST.entities);
            }
            lAST.arcs = [];

            if (pAST && pAST.arcs) {
                pAST.arcs
                    .forEach(function(pArcRow) {
                        unwindArcRow(pArcRow, 0)
                            .forEach(function(pUnwoundArcRow){
                                lAST.arcs.push(pUnwoundArcRow);
                            });
                    });
            }
            lAST.depth = gMaxDepth + 1;
            return lAST;
        }

        function explodeBroadcastArc(pEntities, pArc) {
            return pEntities.filter(function(pEntity){
                return pArc.from !== pEntity.name;
            }).map(function(pEntity) {
                pArc.to = pEntity.name;
                return _.cloneDeep(pArc);
            });
        }

        function _explodeBroadcasts(pAST) {
            if (pAST.entities && pAST.arcs) {
                var lExplodedArcsAry = [];
                var lOriginalBroadcastArc = {};
                pAST.arcs.forEach(function(pArcRow, pArcRowIndex) {
                    pArcRow
                        .filter(function(pArc){
                        /* assuming swap has been done already and "*"
                           is in no 'from'  anymore */
                            return pArc.to === "*";
                        })
                        .forEach(function(pArc, pArcIndex) {
                        /* save a clone of the broadcast arc attributes
                         * and remove the original bc arc
                         */
                            lOriginalBroadcastArc = _.cloneDeep(pArc);
                            delete pAST.arcs[pArcRowIndex][pArcIndex];
                            lExplodedArcsAry = explodeBroadcastArc(pAST.entities, lOriginalBroadcastArc);
                            pArcRow[pArcIndex] = lExplodedArcsAry.shift();
                            pAST.arcs[pArcRowIndex] = pArcRow.concat(lExplodedArcsAry);
                        });
                });
            }
            return pAST;
        }

        return {
        /**
         * If the arc is "facing backwards" (right to left) this function sets the arc
         * kind to the left to right variant (e.g. <= becomes =>) and swaps the operands
         * resulting in an equivalent (b << a becomes a >> b).
         *
         * If the arc is facing forwards or is symetrical, it is left alone.
         *
         * @param {arc} pArc
         * @return {arc}
         */
            swapRTLArc : _swapRTLArc,
            /**
         * Flattens any recursion in the arcs of the given abstract syntax tree to make it
         * more easy to render.
         *
         * @param {ast} pAST
         * @return {ast}
         */
            unwind : _unwind,
            /**
         * expands "broadcast" arcs to its individual counterparts
         * Example in mscgen:
         * msc{
         *     a,b,c,d;
         *     a -> *;
         * }
         * output:
         * msc {
         *     a,b,c,d;
         *     a -> b, a -> c, a -> d;
         * }
         */
            explodeBroadcasts : _explodeBroadcasts,
            /**
         * Simplifies an AST:
         *    - entities without a label get one (the name of the label)
         *    - arc directions get unified to always go forward
         *      (e.g. for a <- b swap entities and reverse direction so it becomes a -> b)
         *    - explodes broadcast arcs
         *    - flattens any recursion (see the {@linkcode unwind} function in
         *      in this module)
         *    - distributes arc*color from the entities to the affected arcs
         * @param {ast} pAST
         * @return {ast}
         */
            flatten : function(pAST) {
                pAST.options = normalizeoptions(pAST.options);
                return asttransform.transform(
                    _unwind(pAST),
                    [nameAsLabel, unescapeLabels],
                    [_swapRTLArc, overrideColors, unescapeLabels, emptyStringForNoLabel]
                );
            },
            /**
         * Simplifies an AST same as the @link {flatten} function, but without flattening the recursion
         *
         * @param {ast} pAST
         * @return {ast}
         */
            dotFlatten : function(pAST) {
                return _explodeBroadcasts(
                    asttransform.transform(
                        pAST,
                        [nameAsLabel],
                        [_swapRTLArc, overrideColors]
                    )
                );
            }
        };
    });

/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/kind2class',[],function() {
    "use strict";

    var KIND2CLASS = {
        "|||"   : "empty-row",
        "..."   : "omitted-row",
        "---"   : "comment-row",
        "->"    : "signal",
        "=>"    : "method",
        "=>>"   : "callback",
        ">>"    : "return",
        ":>"    : "emphasised",
        "-x"    : "lost",
        "<-"    : "signal",
        "<="    : "method",
        "<<="   : "callback",
        "<<"    : "return",
        "<:"    : "emphasised",
        "x-"    : "lost",
        "<->"   : "signal",
        "<=>"   : "method",
        "<<=>>" : "callback",
        "<<>>"  : "return",
        "<:>"   : "emphasised",
        "--"    : "signal",
        "=="    : "method",
        ".."    : "return",
        "::"    : "emphasised"
    };

    var KIND2AGGREGATECLASS = {
        "|||" : "empty",
        "..." : "empty",
        "---" : "empty",
        "->" : "directional",
        "=>" : "directional",
        "=>>" : "directional",
        ">>" : "directional",
        ":>" : "directional",
        "-x" : "directional",
        "<-" : "directional",
        "<=" : "directional",
        "<<=" : "directional",
        "<<" : "directional",
        "<:" : "directional",
        "x-" : "directional",
        "note" : "box",
        "box" : "box",
        "abox" : "box",
        "rbox" : "box",
        "<->" : "bidirectional",
        "<=>" : "bidirectional",
        "<<=>>" : "bidirectional",
        "<<>>" : "bidirectional",
        "<:>" : "bidirectional",
        "--" : "nondirectional",
        "==" : "nondirectional",
        ".." : "nondirectional",
        "::" : "nondirectional",
        "alt" : "inline_expression",
        "else" : "inline_expression",
        "opt" : "inline_expression",
        "break" : "inline_expression",
        "par" : "inline_expression",
        "seq" : "inline_expression",
        "strict" : "inline_expression",
        "neg" : "inline_expression",
        "critical" : "inline_expression",
        "ignore" : "inline_expression",
        "consider" : "inline_expression",
        "assert" : "inline_expression",
        "loop" : "inline_expression",
        "ref" : "inline_expression",
        "exc" : "inline_expression"
    };

    return {
        getClass : function(pKey) { return KIND2CLASS[pKey] || pKey; },
        getAggregateClass : function(pKey) { return KIND2AGGREGATECLASS[pKey] || pKey; }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/rowmemory',[],function() {
    "use strict";

    /**
     * Functions to help determine the correct height and
     * y position of rows befor rendering them.
     */
    var gRowInfo = [];
    var gDefaultEntityHeight = 0;
    var gDefaultArcRowHeight = 0;

    function get(pRowNumber) {
        if (gRowInfo[pRowNumber]) {
            return gRowInfo[pRowNumber];
        } else {
            return {
                y : (gDefaultEntityHeight + (1.5 * gDefaultArcRowHeight)) + pRowNumber * gDefaultArcRowHeight,
                height : gDefaultArcRowHeight
            };
        }
    }

    return {

        /**
         * clearRowInfo() - resets the helper array to an empty one
         */
        clear: function(pEntityHeight, pArcRowHeight) {
            gRowInfo = [];
            gDefaultEntityHeight = pEntityHeight;
            gDefaultArcRowHeight = pArcRowHeight;
        },

        /**
         * get() - returns the row info for a given pRowNumber.
         * If the row info was not set earlier with a setRowinfo call
         * the function returns a best guess, based on defaults
         *
         * @param <int> pRowNumber
         */
        get: get,

        getLast: function(){
            return get(gRowInfo.length - 1);
        },

        /**
         * set() - stores the pHeight for the given pRowNumber, and sets
         *         the y coordinate of the row
         *
         * @param <int> pRowNumber
         * @param <int> pHeight
         */
        set: function (pRowNumber, pHeight) {
            var lPreviousRowInfo = get(pRowNumber - 1);

            gRowInfo[pRowNumber] = {
                y : lPreviousRowInfo.y + (lPreviousRowInfo.height + pHeight) / 2,
                height : pHeight
            };
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/markermanager',['require','../../lib/lodash/lodash.custom','../astmassage/normalizekind'],function(require){
    "use strict";

    var _             = require("../../lib/lodash/lodash.custom");
    var normalizekind = require("../astmassage/normalizekind");

    var KINDS = {
        "->"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}{{signal-marker-end}}-{{color}})"}
            ],
            marker : {
                name : "signal"
            }
        },
        "<->"   : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}{{signal-marker-end}}-{{color}})"},
                {name: "marker-start", value: "url(#{{id}}{{signal-marker-start}}-{{color}})"}
            ],
            marker : {
                name : "signal"
            }
        },
        "=>>"   : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}callback-{{color}})"}
            ],
            marker: {
                name : "callback",
                end : ""
            }
        },
        "<<=>>" : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}callback-{{color}})"},
                {name: "marker-start", value: "url(#{{id}}callback-l-{{color}})"}
            ],
            marker: {
                name : "callback",
                end : "",
                start : "-l"
            }
        },
        ">>"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}callback-{{color}})"}
            ],
            marker: {
                name : "callback",
                end : ""
            }
        },
        "<<>>"  : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}callback-{{color}})"},
                {name: "marker-start", value: "url(#{{id}}callback-l-{{color}})"}
            ],
            marker: {
                name : "callback",
                end : "",
                start : "-l"
            }
        },
        ".."    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"}
            ]
        },
        "--"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"}
            ]
        },
        "=="    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"}
            ]
        },
        "::"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"}
            ]
        },
        "=>"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}method-{{color}})"}
            ],
            marker: {
                name : "method",
                end : ""
            }
        },
        "<=>"   : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}method-{{color}})"},
                {name: "marker-start", value: "url(#{{id}}method-l-{{color}})"}
            ],
            marker: {
                name : "method",
                end : "",
                start : "-l"
            }
        },
        ":>"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}};"},
                {name: "marker-end", value: "url(#{{id}}method-{{color}})"}
            ],
            marker: {
                name : "method",
                end : ""
            }
        },
        "<:>"   : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}method-{{color}})"},
                {name: "marker-start", value: "url(#{{id}}method-l-{{color}})"}
            ],
            marker: {
                name : "method",
                end : "",
                start : "-l"
            }
        },
        "-x"    : {
            attributes : [
                {name: "style", value: "stroke:{{color}}"},
                {name: "marker-end", value: "url(#{{id}}lost-{{color}})"}
            ],
            marker: {
                name : "lost",
                end : ""
            }
        }
    };

    var MARKERPATHS = {
        "signal" : {
            "variants" : [
                {name : "",    path : "M9,3 l-8, 2"},
                {name : "-u",  path : "M9,3 l-8,-2"},
                {name : "-l",  path : "M9,3 l 8, 2"},
                {name : "-lu", path : "M9,3 l 8,-2"}
            ]
        },
        "method" : {
            "variants" : [
                {name : "",   path : "1,1  9,3  1,5"},
                {name : "-l", path : "17,1 9,3 17,5"}
            ]
        },
        "callback" : {
            "variants" : [
                {name : "",  path :  "M 1,1 l 8,2 l-8,2"},
                {name : "-l", path : "M17,1 l-8,2 l 8,2"}
            ]
        },
        "lost" : {
            "variants" : [
                {name : "",  path : "M7,0 l5,6 M7,6 l5,-6"}
            ]
        }
    };


    function getSignalend(pKind, pFrom, pTo){
        if (pFrom && pTo && (["<->", "->"].indexOf(pKind) > -1)) {
            return (pFrom < pTo) ? "signal" : "signal-u";
        }
        return "";
    }

    function getSignalstart(pKind, pFrom, pTo){
        if ("<->" === pKind && pFrom <= pTo){
            return "signal-l";
        } else {
            return "signal-lu";
        }
    }

    function _getAttributes(pId, pKind, pLineColor, pFrom, pTo){
        var lRetval = [];

        if (KINDS[pKind] && KINDS[pKind].attributes){
            lRetval = KINDS[pKind].attributes.map(function(pAttribute){
                return {
                    name: pAttribute.name,
                    value: pAttribute.value
                        .replace(/\{\{signal-marker-end\}\}/g, getSignalend(pKind, pFrom, pTo))
                        .replace(/\{\{signal-marker-start\}\}/g, getSignalstart(pKind, pFrom, pTo))
                        .replace(/\{\{id\}\}/g, pId)
                        .replace(/\{\{color\}\}/g, pLineColor || "black")
                };
            });
        }
        return lRetval;
    }

    function makeKindColorCombi (pKind, pColor) {
        return  KINDS[normalizekind.getNormalizedKind(pKind)].marker.name +
                (Boolean(pColor) ? " " + pColor : " black");
    }

    function extractKindColorCombisFromArc(pKindColorCombis, pArc){
        function _extractKindColorCombis (pArcElt){
            extractKindColorCombisFromArc(pKindColorCombis, pArcElt);
        }
        if (Array.isArray(pArc)){
            pArc.forEach(_extractKindColorCombis);
        }
        if (!!pArc.arcs){
            pArc.arcs.forEach(_extractKindColorCombis);
        }
        if (!!pArc.kind && !!KINDS[normalizekind.getNormalizedKind(pArc.kind)] &&
            !!(KINDS[normalizekind.getNormalizedKind(pArc.kind)].marker) &&
            pKindColorCombis.indexOf(makeKindColorCombi(pArc.kind, pArc.linecolor)) < 0){
            pKindColorCombis.push(makeKindColorCombi(pArc.kind, pArc.linecolor));
        }
        return pKindColorCombis;
    }

    function toColorCombiObject(pColorCombi){
        return {kind: pColorCombi.split(" ")[0], color: pColorCombi.split(" ")[1]};
    }

    /*
     * We only run through the arcs, while entities
     * also define colors for arcs with their arclinecolor.
     * So why does this work?
     * Because the pAST that is passed here, is usually "flattened"
     * with the ast flattening module (flatten.js), which already distributes
     * the arclinecolors from the entities to linecolors in the arc.
     *
     * For the same reason it's not really necessary to handle the recursion
     * of inline expressions (note that the code is doing that notwithstanding)
     */
    function extractKindColorCombis(pAST){
        return pAST.arcs.reduce(extractKindColorCombisFromArc, []).sort().map(toColorCombiObject);
    }

    return {
        getAttributes: _getAttributes,

        getMarkerDefs : function (pId, pAST) {
            return _.flatten(extractKindColorCombis(pAST).map(function(pCombi){
                return MARKERPATHS[pCombi.kind].variants.map(function(pVariant){
                    return {
                        name: pId + pCombi.kind + pVariant.name + "-" + pCombi.color,
                        path: pVariant.path,
                        color: pCombi.color,
                        type: pCombi.kind
                    };
                });
            }));
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define(
/**
 * A hodge podge of functions manipulating text
 *
 * @exports node/textutensils
 * @author {@link https://github.com/sverweij | Sander Verweij}
 */
    'lib/mscgenjs-core/render/textutensils/wrap',[],function() {
        "use strict";

        return {
        /**
         * Wraps text on the first space found before pMaxlength,
         * or exactly pMaxLength when no space was found.
         * Classic "greedy" algorithm.
         * @param {string} pText
         * @param {int} pMaxLength
         * @return {Array of string}
         */
            wrap : function (pText, pMaxLength) {
                var lCharCount = 0;
                var lRetval = [];
                var lStart = 0;
                var lNewStart = 0;
                var lEnd = 0;

                var i = 0;
                var lText = pText.replace(/[\t\n]+/g, " ").replace(/\\n/g, "\n");

                while (i <= lText.length) {
                    if (i >= (lText.length)) {
                        lRetval.push(lText.substring(lStart, i));
                    } else if (lText[i] === '\n') {
                        lCharCount = 0;
                        lEnd = i;
                        lRetval.push(lText.substring(lStart, lEnd));
                        lStart = lEnd + 1;
                    } else if ((lCharCount++ >= pMaxLength)) {
                        lEnd = lText.substring(0, i).lastIndexOf(' ');
                        if (lEnd === -1 || lEnd < lStart) {
                            lCharCount = 1;
                            lEnd = i;
                            lNewStart = i;
                        } else {
                            lCharCount = 0;
                            lNewStart = lEnd + 1;
                        }
                        lRetval.push(lText.substring(lStart, lEnd));
                        lStart = lNewStart;
                    }
                    i++;
                }
                return lRetval;
            }
        };
    });
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/renderlabels',['require','./svgelementfactory/index','./svgutensils','./constants','../textutensils/wrap','./kind2class','../astmassage/aggregatekind'],function(require) {
    "use strict";
    var svgelementfactory = require("./svgelementfactory/index");
    var svgutensils       = require("./svgutensils");
    var constants         = require("./constants");
    var wrap              = require("../textutensils/wrap");
    var kind2class        = require("./kind2class");
    var aggregatekind     = require("../astmassage/aggregatekind");

    /**
     * Sets the fill color of the passed pElement to the textcolor of
     * the given pArc
     *
     * @param <svgElement> pElement
     * @param <string> pTextColor
     */
    function colorText(pElement, pTextColor) {
        if (pTextColor) {
            pElement.setAttribute("style", "fill:" + pTextColor + ";");
        }
    }

    /**
     * Makes the text color blue if there is an url and no text color
     *
     * @param <svgElement> pElement
     * @param <string> pUrl
     * @param <string> pTextColor
     */
    function colorLink(pElement, pUrl, pTextColor){
        colorText(pElement, (pUrl && !pTextColor) ? "blue" : pTextColor);
    }

    function renderArcLabelLineBackground(lLabelElement, pTextbgcolor){
        var lRect = svgelementfactory.createRect(svgutensils.getBBox(lLabelElement), "label-text-background");
        if (pTextbgcolor) {
            lRect.setAttribute("style", "fill:" + pTextbgcolor + "; stroke:" + pTextbgcolor + ";");
        }
        return lRect;
    }

    function renderLabelText(pPosition, pLine, pMiddle, pY, pClass, pArc){
        var lText = {};
        if (pPosition === 0) {
            lText = svgelementfactory.createText(
                pLine,
                {
                    x : pMiddle,
                    y : pY
                },
                {
                    class : pClass,
                    url   : pArc.url,
                    id    : pArc.id,
                    idurl : pArc.idurl
                }
            );
        } else {
            lText = svgelementfactory.createText(
                pLine,
                {
                    x : pMiddle,
                    y : pY
                },
                {
                    class : pClass,
                    url   : pArc.url
                }
            );
        }
        return lText;
    }

    function determineClasses(pArcKind, pOptionsKind, pPostFix){
        var lKind = pOptionsKind || pArcKind;
        var lClass = kind2class.getClass(lKind);
        var lAggregateClass = kind2class.getAggregateClass(lKind);

        return lClass === lAggregateClass
            ? lClass + pPostFix
            : lAggregateClass + pPostFix + lClass + pPostFix;
    }

    function createLabelLine(pLine, pMiddle, pStartY, pArc, pPosition, pOptions) {
        var lY = pStartY + ((pPosition + 1 / 4) * svgutensils.calculateTextHeight());
        var lClass = determineClasses(pArc.kind, pOptions && pOptions.kind, "-text ");

        if (!!pOptions){
            if (pOptions.alignLeft){
                lClass += "anchor-start ";
            }
            if (pOptions.alignAround){
                lY = pStartY + ((pPosition + 1 / 4) * (svgutensils.calculateTextHeight() + constants.LINE_WIDTH));
            }
        }
        var lText = renderLabelText(pPosition, pLine, pMiddle, lY, lClass, pArc);

        colorText(lText, pArc.textcolor);
        colorLink(lText, pArc.url, pArc.textcolor);

        return lText;
    }

    function _createLabel(pArc, pDims, pOptions, pId) {
        var lGroup = svgelementfactory.createGroup(pId);

        if (pArc.label) {
            var lMiddle = pDims.x + (pDims.width / 2);
            var lLines = _splitLabel(
                pArc.label,
                pArc.kind,
                pDims.width,
                constants.FONT_SIZE,
                pOptions
            );
            var lText = {};
            if (!!pOptions && pOptions.alignAbove){
                lLines.forEach(function(){
                    lLines.push("");
                });
            }

            var lStartY = pDims.y - (lLines.length - 1) / 2 * (svgutensils.calculateTextHeight() + 1);
            if (!!pOptions && pOptions.alignAround){
                if (lLines.length === 1) {
                    lLines.push("");
                }
                lStartY = pDims.y - (lLines.length - 1) / 2 * (svgutensils.calculateTextHeight() + constants.LINE_WIDTH + 1);
            }
            lLines
                .forEach(
                    function(pLine, pLineNumber){
                        if (pLine !== "") {
                            lText = createLabelLine(pLine, lMiddle, lStartY, pArc, pLineNumber, pOptions);
                            if (!!pOptions && pOptions.ownBackground){
                                lGroup.appendChild(renderArcLabelLineBackground(lText, pArc.textbgcolor));
                            }
                            lGroup.appendChild(lText);
                        }
                        lStartY++;
                    }
                );
        }
        return lGroup;
    }

    /**
     * Determine the number characters that fit within pWidth amount
     * of pixels.
     *
     * Uses heuristics that work for 9pt/12px Helvetica in svg's.
     * TODO: make more generic, or use an algorithm that
     *       uses the real width of the text under discourse
     *       (e.g. using its BBox; although I fear this
     *        to be expensive)
     * @param {string} pWidth - the amount to calculate the # characters
     *        to fit in for
     * @param {number} - pFontSize (in px)
     * @return {number} - The maxumum number of characters that'll fit
     */
    function _determineMaxTextWidthInChars (pWidth, pFontSize) {
        var lAbsWidth = Math.abs(pWidth);
        var REFERENCE_FONT_SIZE = 12; // px

        if (lAbsWidth <= 160) {
            return lAbsWidth / ((pFontSize / REFERENCE_FONT_SIZE) * 8);
        }
        if (lAbsWidth <= 320) {
            return lAbsWidth / ((pFontSize / REFERENCE_FONT_SIZE) * 6.4);
        }
        if (lAbsWidth <= 480) {
            return lAbsWidth / ((pFontSize / REFERENCE_FONT_SIZE) * 5.9);
        }
        return lAbsWidth / ((pFontSize / REFERENCE_FONT_SIZE) * 5.6);
    }

    function _splitLabel(pLabel, pKind, pWidth, pFontSize, pOptions) {
        if (("box" === aggregatekind.getAggregate(pKind) && pOptions.wordwrapboxes) ||
            ("entity" === pKind && pOptions.wordwrapentities) ||
            ("box" !== aggregatekind.getAggregate(pKind) && "entity" !== pKind && pOptions.wordwraparcs) ||
            typeof pKind === 'undefined'
        ){
            return wrap.wrap(pLabel, _determineMaxTextWidthInChars(pWidth, pFontSize));
        } else {
            return pLabel.split('\\n');
        }
    }

    return {
        /**
         * createLabel() - renders the text (label, id, url) for a given pArc
         * with a bounding box starting at pStartX, pStartY and of a width of at
         * most pWidth (all in pixels)
         *
         * @param <string> - pId - the unique identification of the textlabe (group) within the svg
         * @param <object> - pArc - the arc of which to render the text
         * @param <object> - pDims - x and y to start on and a width
         * @param <object> - pOptions - alignAbove, alignLeft, alignAround, wordWrapArcs, ownBackground, underline
         */
        createLabel: _createLabel,

        /**
         * splitLabel () - splits the given pLabel into an array of strings
         * - if the arc kind passed is a box the split occurs regardless
         * - if the arc kind passed is something else, the split occurs
         *   only if the _word wrap arcs_ option is true.
         *
         * @param <string> - pLabel
         * @param <string> - pKind
         * @param <number> - pWidth
         * @param <number> - pFontSize (in px)
         * @param <object> - options (the one ones heeded: wordwraparcs, wordwrapentities, wordwrapboxes)
         * @return <array of strings> - lLines
         */
        splitLabel: _splitLabel

    };
});

/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/entities',['require','./renderlabels'],function(require){
    "use strict";

    var renderlabels = require("./renderlabels");

    var DEFAULT_INTER_ENTITY_SPACING = 160; // px
    var DEFAULT_ENTITY_WIDTH         = 100; // px
    var DEFAULT_ENTITY_HEIGHT        = 34; // px

    var gEntityDims = {
        interEntitySpacing : DEFAULT_INTER_ENTITY_SPACING,
        height             : DEFAULT_ENTITY_HEIGHT,
        width              : DEFAULT_ENTITY_WIDTH
    };

    var gEntity2X = {};

    function getX (pName){
        return gEntity2X[pName];
    }

    return {
        init: function (pHScale){
            gEntityDims.interEntitySpacing = DEFAULT_INTER_ENTITY_SPACING;
            gEntityDims.height             = DEFAULT_ENTITY_HEIGHT;
            gEntityDims.width              = DEFAULT_ENTITY_WIDTH;

            if (pHScale) {
                gEntityDims.interEntitySpacing = pHScale * DEFAULT_INTER_ENTITY_SPACING;
                gEntityDims.width              = pHScale * DEFAULT_ENTITY_WIDTH;
            }
            gEntity2X = {};
        },
        getX: getX,
        setX: function (pEntity, pX){
            gEntity2X[pEntity.name] = pX + (gEntityDims.width / 2);
        },
        getOAndD: function (pFrom, pTo){
            return {
                from: getX(pFrom) < getX(pTo) ? getX(pFrom) : getX(pTo),
                to: getX(pTo) > getX(pFrom) ? getX(pTo) : getX(pFrom)
            };
        },
        setHeight: function (pHeight){
            gEntityDims.height = pHeight;
        },
        getDims: function (){
            return gEntityDims;
        },
        getNoEntityLines: function(pLabel, pFontSize, pOptions){
            return renderlabels.splitLabel(pLabel, "entity", gEntityDims.width, pFontSize, pOptions).length;
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore else */


define('lib/mscgenjs-core/render/graphics/renderast',['require','./svgelementfactory/index','./svgutensils','./renderutensils','./renderskeleton','../astmassage/flatten','./kind2class','../astmassage/aggregatekind','./rowmemory','./idmanager','./markermanager','./entities','./renderlabels','./constants','../../lib/lodash/lodash.custom'],function(require) {
    /**
     *
     * renders an abstract syntax tree of a sequence chart
     *
     * knows of:
     *  - the syntax tree
     *  - the target canvas
     *
     * Defines default sizes and distances for all objects.
     * @exports renderast
     * @author {@link https://github.com/sverweij | Sander Verweij}
     */
    "use strict";

    var svgelementfactory  = require("./svgelementfactory/index");
    var svgutensils        = require("./svgutensils");
    var renderutensils     = require("./renderutensils");
    var renderskeleton     = require("./renderskeleton");
    var flatten            = require("../astmassage/flatten");
    var kind2class         = require("./kind2class");
    var aggregatekind      = require("../astmassage/aggregatekind");
    var rowmemory          = require("./rowmemory");
    var idmanager          = require("./idmanager");
    var markermanager      = require("./markermanager");
    var entities           = require("./entities");
    var renderlabels       = require("./renderlabels");
    var constants          = require("./constants");
    var _                  = require("../../lib/lodash/lodash.custom");

    var PAD_VERTICAL          = 3;
    var DEFAULT_ARCROW_HEIGHT = 38; // chart only
    var DEFAULT_ARC_GRADIENT  = 0; // chart only

    /* sensible default - get overwritten in bootstrap */
    var gChart = Object.seal({
        "arcRowHeight"           : DEFAULT_ARCROW_HEIGHT,
        "arcGradient"            : DEFAULT_ARC_GRADIENT,
        "arcEndX"                : 0,
        "wordWrapArcs"           : false,
        "mirrorEntitiesOnBottom" : false,
        "regularArcTextVerticalAlignment": "middle",
        "maxDepth"               : 0,
        "document"               : {},
        "layer"                  : {
            "lifeline"     : {},
            "sequence"     : {},
            "notes"        : {},
            "inline"       : {},
            "watermark"    : {}
        }
    });
    var gInlineExpressionMemory = [];

    function _renderASTNew(pAST, pWindow, pParentElementId, pOptions) {
        var lAST = Object.seal(flatten.flatten(pAST));
        var lOptions = pOptions || {};

        lOptions = _.defaults(lOptions, {
            source                 : null,
            styleAdditions         : null,
            mirrorEntitiesOnBottom : false,
            regularArcTextVerticalAlignment: "middle"
        });

        renderASTPre(
            lAST,
            pWindow,
            pParentElementId,
            lOptions
        );
        renderASTMain(lAST);
        renderASTPost(lAST);
        var lElement = pWindow.document.getElementById(pParentElementId);
        if (lElement) {
            return svgutensils.webkitNamespaceBugWorkaround(lElement.innerHTML);
        } else {
            return svgutensils.webkitNamespaceBugWorkaround(pWindow.document.body.innerHTML);
        }
    }

    function normalizeVerticalAlignment(pVerticalAlignment) {
        var lRetval = "middle";
        var VALID_ALIGNMENT_VALUES = ["above", "middle", "below"];

        if (VALID_ALIGNMENT_VALUES.some(
            function(pValue){
                return pValue === pVerticalAlignment;
            }
        )){
            lRetval = pVerticalAlignment;
        }

        return lRetval;
    }

    function renderASTPre(pAST, pWindow, pParentElementId, pOptions){
        idmanager.setPrefix(pParentElementId);

        gChart.document = renderskeleton.bootstrap(
            pWindow,
            pParentElementId,
            idmanager.get(),
            markermanager.getMarkerDefs(idmanager.get(), pAST),
            pOptions
        );
        gChart.mirrorEntitiesOnBottom = Boolean(pOptions.mirrorEntitiesOnBottom);
        gChart.regularArcTextVerticalAlignment = normalizeVerticalAlignment(pOptions.regularArcTextVerticalAlignment);
        svgutensils.init(gChart.document);

        gChart.layer = createLayerShortcuts(gChart.document);
        gChart.maxDepth = pAST.depth;

        preProcessOptions(gChart, pAST.options);
    }

    function renderASTMain(pAST){
        renderEntities(pAST.entities, pAST.options);
        rowmemory.clear(entities.getDims().height, gChart.arcRowHeight);
        renderArcRows(pAST.arcs, pAST.entities, pAST.options);
        if (gChart.mirrorEntitiesOnBottom){
            renderEntitiesOnBottom(pAST.entities);
        }
    }

    function renderASTPost(pAST){
        var lCanvas = calculateCanvasDimensions(pAST);

        /* canvg ignores the background-color on svg level and makes the background
         * transparent in stead. To work around this insert a white rectangle the size
         * of the canvas in the background layer.
         *
         * We do this _before_ scaling is applied to the svg
         */
        renderBackground(lCanvas);
        lCanvas = postProcessOptions(pAST.options, lCanvas);
        renderSvgElement(lCanvas);
    }

    function createLayerShortcuts (pDocument){
        return {
            lifeline  : pDocument.getElementById(idmanager.get("_lifelines")),
            sequence  : pDocument.getElementById(idmanager.get("_sequence")),
            notes     : pDocument.getElementById(idmanager.get("_notes")),
            inline    : pDocument.getElementById(idmanager.get("_arcspans")),
            watermark : pDocument.getElementById(idmanager.get("_watermark"))
        };
    }

    function preProcessOptionsArcs(pChart, pOptions){
        pChart.arcRowHeight = DEFAULT_ARCROW_HEIGHT;
        pChart.arcGradient  = DEFAULT_ARC_GRADIENT;
        pChart.wordWrapArcs = false;

        if (pOptions) {
            if (pOptions.arcgradient) {
                pChart.arcRowHeight = parseInt(pOptions.arcgradient, 10) + DEFAULT_ARCROW_HEIGHT;
                pChart.arcGradient  = parseInt(pOptions.arcgradient, 10) + DEFAULT_ARC_GRADIENT;
            }
            pChart.wordWrapArcs = Boolean(pOptions.wordwraparcs);
        }
    }

    /**
     * preProcessOptions() -
     * - resets the global variables governing entity width and height,
     *   row height to their default values
     * - modifies them if passed
     *   - hscale (influences the entity width and inter entity spacing defaults)
     *   - arcgradient (influences the arc row height, sets the global arc gradient)
     *   - wordwraparcs (sets the wordwraparcs global)
     *
     * Note that width is not processed here as this can only be done
     * reliably after most rendering calculations have been executed.
     *
     * @param <object> - pOptions - the option part of the AST
     */
    function preProcessOptions(pChart, pOptions) {
        entities.init(pOptions && pOptions.hscale);
        preProcessOptionsArcs(pChart, pOptions);
    }

    function calculateCanvasDimensions(pAST){
        var lDepthCorrection = renderutensils.determineDepthCorrection(pAST.depth, constants.LINE_WIDTH);
        var lRowInfo = rowmemory.getLast();
        var lCanvas = {
            "width" :
                (pAST.entities.length * entities.getDims().interEntitySpacing) + lDepthCorrection,
            "height" :
                Boolean(gChart.mirrorEntitiesOnBottom)
                    ? (2 * entities.getDims().height) + lRowInfo.y + lRowInfo.height + 2 * PAD_VERTICAL
                    : lRowInfo.y + (lRowInfo.height / 2) + 2 * PAD_VERTICAL,
            "horizontaltransform" :
                (entities.getDims().interEntitySpacing + lDepthCorrection - entities.getDims().width) / 2,
            "autoscale" :
                !!pAST.options && !!pAST.options.width && pAST.options.width === "auto",
            "verticaltransform" :
                PAD_VERTICAL,
            "scale" : 1
        };
        lCanvas.x = 0 - lCanvas.horizontaltransform;
        lCanvas.y = 0 - lCanvas.verticaltransform;
        return lCanvas;
    }

    function renderBackground(pCanvas) {
        gChart.document.getElementById(idmanager.get("_background")).appendChild(
            svgelementfactory.createRect(pCanvas, "bglayer")
        );
    }

    function renderWatermark(pWatermark, pCanvas) {
        gChart.layer.watermark.appendChild(
            svgelementfactory.createDiagonalText(pWatermark, pCanvas, "watermark")
        );
    }

    function postProcessOptions(pOptions, pCanvas) {
        if (pOptions) {
            if (pOptions.watermark) {
                renderWatermark(pOptions.watermark, pCanvas);
            }
            if (pOptions.width && pOptions.width !== "auto") {
                pCanvas = renderutensils.scaleCanvasToWidth(pOptions.width, pCanvas);
            }
        }
        return pCanvas;
    }

    function renderSvgElement(pCanvas) {
        var lSvgElement = gChart.document.getElementById(idmanager.get());
        var lBody = gChart.document.getElementById(idmanager.get("_body"));
        lBody.setAttribute(
            "transform",
            "translate(" + pCanvas.horizontaltransform + "," + pCanvas.verticaltransform +
                ") scale(" + pCanvas.scale + "," + pCanvas.scale + ")"
        );
        if (!!pCanvas.autoscale && pCanvas.autoscale === true){
            svgelementfactory.updateSVG(
                lSvgElement,
                {
                    width: "100%",
                    height: "100%",
                    viewBox: "0 0 " + pCanvas.width.toString() + " " + pCanvas.height.toString()
                }
            );
        } else {
            svgelementfactory.updateSVG(
                lSvgElement,
                {
                    width: pCanvas.width.toString(),
                    height: pCanvas.height.toString(),
                    viewBox: "0 0 " + pCanvas.width.toString() + " " + pCanvas.height.toString()
                }
            );
        }
    }

    /* ----------------------START entity shizzle-------------------------------- */
    /**
     * getMaxEntityHeight() -
     * crude method for determining the max entity height;
     * - take the entity with the most number of lines
     * - if that number > 2 (default entity hight easily fits 2 lines of text)
     *   - render that entity
     *   - return the height of its bbox
     *
     * @param <object> - pEntities - the entities subtree of the AST
     * @return <int> - height - the height of the heighest entity
     */
    function getMaxEntityHeight(pEntities, pOptions){
        var lHighestEntity = pEntities[0];
        var lHWM = 2;
        pEntities.forEach(function(pEntity){
            var lNoEntityLines = entities.getNoEntityLines(pEntity.label, constants.FONT_SIZE, pOptions);
            if (lNoEntityLines > lHWM){
                lHWM = lNoEntityLines;
                lHighestEntity = pEntity;
            }
        });

        if (lHWM > 2){
            return Math.max(
                entities.getDims().height,
                svgutensils.getBBox(
                    renderEntity(lHighestEntity, 0, pOptions)
                ).height
            );
        }
        return entities.getDims().height;
    }

    function sizeEntityBoxToLabel(pLabel, pBBox) {
        var lLabelWidth = Math.min(
            svgutensils.getBBox(pLabel).width + (4 * constants.LINE_WIDTH),
            (pBBox.interEntitySpacing / 3) + pBBox.width
        );
        if (lLabelWidth >= pBBox.width) {
            pBBox.x -= (lLabelWidth - pBBox.width) / 2;
            pBBox.width = lLabelWidth;
        }
        return pBBox;
    }

    function renderEntity(pEntity, pX, pOptions) {
        var lGroup = svgelementfactory.createGroup();
        var lBBox = _.cloneDeep(entities.getDims());
        lBBox.x = pX ? pX : 0;
        var lLabel = renderlabels.createLabel(
            _.defaults(
                pEntity,
                {
                    kind: "entity"
                }
            ),
            {
                x:lBBox.x,
                y:lBBox.height / 2,
                width:lBBox.width
            },
            pOptions
        );

        lGroup.appendChild(
            svgelementfactory.createRect(
                sizeEntityBoxToLabel(lLabel, lBBox),
                "entity",
                pEntity.linecolor,
                pEntity.textbgcolor
            )
        );
        lGroup.appendChild(lLabel);
        return lGroup;
    }

    function renderEntitiesOnBottom(pEntities) {
        var lLifeLineSpacerY = rowmemory.getLast().y + (rowmemory.getLast().height + gChart.arcRowHeight) / 2;

        /*
            insert a life line between the last arc and the entities so there's
            some visual breathing room
         */

        createLifeLines(
            pEntities,
            "arcrow",
            null,
            lLifeLineSpacerY
        ).forEach(function(pLifeLine){
            gChart.layer.lifeline.appendChild(pLifeLine);
        });

        gChart.layer.sequence.appendChild(
            svgelementfactory.createUse(
                {
                    x:0,
                    y:lLifeLineSpacerY + gChart.arcRowHeight / 2
                },
                idmanager.get("entities")
            )
        );
    }

    /**
     * renderEntities() - renders the given pEntities (subtree of the AST) into
     * the gChart.layer.sequence layer
     *
     * @param <object> - pEntities - the entities to render
     */
    function renderEntities(pEntities, pOptions) {
        var lEntityXPos = 0;
        var lEntityGroup = svgelementfactory.createGroup(idmanager.get("entities"));

        if (pEntities) {
            entities.setHeight(getMaxEntityHeight(pEntities, pOptions) + constants.LINE_WIDTH * 2);

            pEntities.forEach(function(pEntity){
                lEntityGroup.appendChild(renderEntity(pEntity, lEntityXPos, pOptions));
                entities.setX(pEntity, lEntityXPos);
                lEntityXPos += entities.getDims().interEntitySpacing;
            });
            gChart.layer.sequence.appendChild(
                lEntityGroup
            );
        }
        gChart.arcEndX =
            lEntityXPos -
            entities.getDims().interEntitySpacing + entities.getDims().width;

    }

    /* ------------------------END entity shizzle-------------------------------- */

    function renderBroadcastArc(pArc, pEntities, lRowMemory, pY, pOptions) {
        var xTo    = 0;
        var lLabel = pArc.label;
        var xFrom  = entities.getX(pArc.from);

        pArc.label = "";

        pEntities.forEach(function(pEntity){
            var lElement = {};

            if (pEntity.name !== pArc.from) {
                xTo = entities.getX(pEntity.name);
                lElement = createArc(pArc, xFrom, xTo, pY, pOptions);
                lRowMemory.push({
                    layer : gChart.layer.sequence,
                    element: lElement
                });
            }
        });

        pArc.label = lLabel;
    }

    function renderRegularArc(pArc, pEntities, pRowMemory, pY, pOptions){
        var lElement = {};

        if (pArc.from && pArc.to) {
            if (pArc.to === "*") { // it's a broadcast arc
                renderBroadcastArc(pArc, pEntities, pRowMemory, pY, pOptions);
                /* creates a label on the current line, smack in the middle */
                lElement =
                    renderlabels.createLabel(
                        pArc,
                        {
                            x     : 0,
                            y     : pY,
                            width : gChart.arcEndX
                        },
                        _.defaults(
                            _.cloneDeep(pOptions),
                            {
                                alignAround   : true,
                                ownBackground : true
                            }
                        )
                    );
                pRowMemory.push({
                    title : pArc.title,
                    layer : gChart.layer.sequence,
                    element: lElement
                });
            } else { // it's a regular arc
                lElement =
                    createArc(
                        pArc,
                        entities.getX(pArc.from),
                        entities.getX(pArc.to),
                        pY,
                        pOptions
                    );
                pRowMemory.push({
                    title : pArc.title,
                    layer : gChart.layer.sequence,
                    element: lElement
                });
            }  // / lTo or pArc.from === "*"
        }// if both a from and a to
        return lElement;
    }

    function getArcRowHeight (pArcRow, pRowNumber, pEntities, pOptions) {
        var lRetval = 0;

        pArcRow.forEach(function(pArc){
            var lElement = {};

            switch (aggregatekind.getAggregate(pArc.kind)) {
            case ("emptyarc"):
                lElement = renderEmptyArc(pArc, 0);
                break;
            case ("box"):
                lElement = createBox(entities.getOAndD(pArc.from, pArc.to), pArc, 0, pOptions);
                break;
            case ("inline_expression"):
                lElement = renderInlineExpressionLabel(pArc, 0);
                break;
            default:
                lElement = renderRegularArc(pArc, pEntities, [], 0, pOptions);
            }// switch

            lRetval = Math.max(
                lRetval,
                svgutensils.getBBox(lElement).height + 2 * constants.LINE_WIDTH
            );
        });// for all arcs in a row

        return lRetval;
    }

    function renderArcRow (pArcRow, pRowNumber, pEntities, pOptions){
        var lArcRowClass = "arcrow";
        var lRowMemory = [];

        rowmemory.set(
            pRowNumber,
            Math.max(
                rowmemory.get(pRowNumber).height,
                getArcRowHeight(pArcRow, pRowNumber, pEntities, pOptions)
            )
        );

        pArcRow.forEach(function(pArc){
            var lElement = {};

            switch (aggregatekind.getAggregate(pArc.kind)) {
            case ("emptyarc"):
                lElement = renderEmptyArc(pArc, rowmemory.get(pRowNumber).y);
                if ("..." === pArc.kind) {
                    lArcRowClass = "arcrowomit";
                }
                lRowMemory.push({
                    layer : gChart.layer.sequence,
                    element: lElement
                });
                break;
            case ("box"):
                lElement = createBox(
                    entities.getOAndD(pArc.from, pArc.to),
                    pArc,
                    rowmemory.get(pRowNumber).y,
                    pOptions
                );
                lRowMemory.push({
                    title : pArc.title,
                    layer : gChart.layer.notes,
                    element: lElement
                });
                break;
            case ("inline_expression"):
                lElement = renderInlineExpressionLabel(pArc, rowmemory.get(pRowNumber).y);
                lRowMemory.push({
                    layer : gChart.layer.notes,
                    element: lElement
                });
                gInlineExpressionMemory.push({
                    arc    : pArc,
                    rownum : pRowNumber
                });
                break;
            default:
                lElement = renderRegularArc(
                    pArc,
                    pEntities,
                    lRowMemory,
                    rowmemory.get(pRowNumber).y,
                    pOptions
                );
            }// switch

        });// for all arcs in a row

        /*
         *  only here we can determine the height of the row and the y position
         */
        createLifeLines(
            pEntities,
            lArcRowClass,
            rowmemory.get(pRowNumber).height,
            rowmemory.get(pRowNumber).y
        ).forEach(function(pLifeLine){
            gChart.layer.lifeline.appendChild(pLifeLine);
        });

        lRowMemory.forEach(function(pRowMemoryLine){
            if (pRowMemoryLine.element){
                if (pRowMemoryLine.title) {
                    pRowMemoryLine.element.appendChild(svgelementfactory.createTitle(pRowMemoryLine.title));
                }
                pRowMemoryLine.layer.appendChild(pRowMemoryLine.element);
            }
        });
    }

    /** renderArcRows() - renders the arcrows from an AST
     *
     * @param <object> - pArcRows - the arc rows to render
     * @param <object> - pEntities - the entities to consider
     */
    function renderArcRows(pArcRows, pEntities, pOptions) {
        gInlineExpressionMemory = [];

        /* put some space between the entities and the arcs */
        createLifeLines(
            pEntities,
            "arcrow",
            null,
            rowmemory.get(-1).y
        ).forEach(function(pLifeLine){
            gChart.layer.lifeline.appendChild(pLifeLine);
        });

        if (pArcRows) {
            for (var i = 0; i < pArcRows.length; i++){
                renderArcRow(pArcRows[i], i, pEntities, pOptions);
            }
            // pArcRows.forEach(renderArcRow);
            renderInlineExpressions(gInlineExpressionMemory);
        } // if pArcRows
    }// function

    /**
     * renderInlineExpressionLabel() - renders the label of an inline expression
     * (/ arc spanning arc)
     *
     * @param <object> pArc - the arc spanning arc
     * @param <number pY - where to start
     */
    function renderInlineExpressionLabel(pArc, pY) {
        var lOnD = entities.getOAndD(pArc.from, pArc.to);
        var FOLD_SIZE = 7;
        var lLabelContentAlreadyDetermined = pY > 0;

        var lMaxDepthCorrection = gChart.maxDepth * 2 * constants.LINE_WIDTH;

        var lMaxWidth =
            (lOnD.to - lOnD.from) +
            (entities.getDims().interEntitySpacing - 2 * constants.LINE_WIDTH) -
            FOLD_SIZE -
            constants.LINE_WIDTH;

        var lStart =
            (lOnD.from - ((entities.getDims().interEntitySpacing - 3 * constants.LINE_WIDTH - lMaxDepthCorrection) / 2) -
            (gChart.maxDepth - pArc.depth) * 2 * constants.LINE_WIDTH);

        var lGroup = svgelementfactory.createGroup();
        if (!lLabelContentAlreadyDetermined){
            pArc.label = pArc.kind + (pArc.label ? ": " + pArc.label : "");
        }

        var lTextGroup = renderlabels.createLabel(
            pArc,
            {
                x: lStart + constants.LINE_WIDTH - (lMaxWidth / 2),
                y: pY + gChart.arcRowHeight / 4,
                width:lMaxWidth
            },
            {
                alignLeft: true,
                ownBackground: false,
                wordwraparcs: gChart.wordWrapArcs
            }
        );

        var lBBox = svgutensils.getBBox(lTextGroup);

        var lHeight =
            Math.max(
                lBBox.height + 2 * constants.LINE_WIDTH,
                (gChart.arcRowHeight / 2) - 2 * constants.LINE_WIDTH
            );
        var lWidth =
            Math.min(
                lBBox.width + 2 * constants.LINE_WIDTH,
                lMaxWidth
            );

        var lBox =
            svgelementfactory.createEdgeRemark(
                {
                    width: lWidth - constants.LINE_WIDTH + FOLD_SIZE,
                    height: lHeight,
                    x: lStart,
                    y: pY
                },
                "box inline_expression_label",
                pArc.linecolor,
                pArc.textbgcolor,
                FOLD_SIZE
            );
        lGroup.appendChild(lBox);
        lGroup.appendChild(lTextGroup);

        return lGroup;
    }

    function renderInlineExpressions(pInlineExpressions) {
        pInlineExpressions.forEach(
            function(pInlineExpression){
                gChart.layer.inline.appendChild(
                    renderInlineExpression(pInlineExpression, rowmemory.get(pInlineExpression.rownum).y)
                );
            }
        );
    }

    function renderInlineExpression(pArcMem, pY) {
        var lFromY = rowmemory.get(pArcMem.rownum).y;
        var lToY = rowmemory.get(pArcMem.rownum + pArcMem.arc.numberofrows + 1).y;
        var lHeight = lToY - lFromY;
        pArcMem.arc.label = "";

        return createInlineExpressionBox(
            entities.getOAndD(pArcMem.arc.from, pArcMem.arc.to),
            pArcMem.arc,
            lHeight,
            pY
        );
    }

    function createLifeLines(pEntities, pClass, pHeight, pY) {
        if (!pHeight || pHeight < gChart.arcRowHeight) {
            pHeight = gChart.arcRowHeight;
        }

        return pEntities.map(function(pEntity) {
            var lLine = svgelementfactory.createLine(
                {
                    xFrom: entities.getX(pEntity.name),
                    yFrom: 0 - (pHeight / 2) + (pY ? pY : 0),
                    xTo: entities.getX(pEntity.name),
                    yTo: (pHeight / 2) + (pY ? pY : 0)
                },
                {
                    class: pClass
                }
            );
            if (pEntity.linecolor) {
                lLine.setAttribute("style", "stroke:" + pEntity.linecolor + ";");
            }
            return lLine;
        });
    }

    function createSelfRefArc(pKind, pFrom, pYTo, pDouble, pLineColor, pY) {
        // globals: (gChart ->) arcRowHeight, (entities ->) interEntitySpacing

        var lHeight = 2 * (gChart.arcRowHeight / 5);
        var lWidth = entities.getDims().interEntitySpacing / 2;
        var lRetval = {};
        var lClass = "arc " + kind2class.getAggregateClass(pKind) + " " + kind2class.getClass(pKind);

        if (pDouble) {
            lRetval = svgelementfactory.createGroup();
            var lInnerTurn  = svgelementfactory.createUTurn(
                {x:pFrom, y: pY},
                (pY + pYTo + lHeight - 2 * constants.LINE_WIDTH),
                lWidth - 2 * constants.LINE_WIDTH,
                lClass,
                pKind !== "::",
                lHeight
            );
            /* we need a middle turn to attach the arrow to */
            var lMiddleTurn = svgelementfactory.createUTurn(
                {x:pFrom, y:pY},
                (pY + pYTo + lHeight - constants.LINE_WIDTH),
                lWidth,
                null,
                null,
                lHeight
            );
            var lOuterTurn  = svgelementfactory.createUTurn(
                {x:pFrom, y:pY},
                (pY + pYTo + lHeight),
                lWidth,
                lClass,
                pKind !== "::",
                lHeight
            );
            if (Boolean(pLineColor)){
                lInnerTurn.setAttribute("style", "stroke:" + pLineColor);
            }
            markermanager.getAttributes(idmanager.get(), pKind, pLineColor, pFrom, pFrom).forEach(function(pAttribute){
                lMiddleTurn.setAttribute(pAttribute.name, pAttribute.value);
            });
            lMiddleTurn.setAttribute("style", "stroke:transparent;");
            if (Boolean(pLineColor)){
                lOuterTurn.setAttribute("style", "stroke:" + pLineColor);
            }
            lRetval.appendChild(lInnerTurn);
            lRetval.appendChild(lOuterTurn);
            lRetval.appendChild(lMiddleTurn);
            lRetval.setAttribute("class", lClass);
        } else {
            lRetval = svgelementfactory.createUTurn(
                {
                    x:pFrom,
                    y:pY
                },
                (pY + pYTo + lHeight),
                lWidth,
                lClass,
                pKind === "-x",
                lHeight
            );
            markermanager.getAttributes(idmanager.get(), pKind, pLineColor, pFrom, pFrom).forEach(
                function(pAttribute){
                    lRetval.setAttribute(pAttribute.name, pAttribute.value);
                }
            );
        }

        return lRetval;
    }

    function renderEmptyArc(pArc, pY) {
        if (pArc.kind === "---"){
            return createComment(pArc, entities.getOAndD(pArc.from, pArc.to), pY);
        } else { /* "..." / "|||" */
            return createLifeLinesText(pArc, entities.getOAndD(pArc.from, pArc.to), pY);
        }
    }

    function determineArcYTo(pArc){
        return pArc.arcskip ? pArc.arcskip * gChart.arcRowHeight : 0;
    }

    function determineDirectionClass(pArcKind) {
        if (pArcKind === "<:>"){
            return "bidi ";
        } else if (pArcKind === "::"){
            return "nodi ";
        }
        return "";
    }

    function createArc(pArc, pFrom, pTo, pY, pOptions) {
        var lGroup = svgelementfactory.createGroup();
        var lClass = "arc ";
        lClass += determineDirectionClass(pArc.kind);
        lClass += kind2class.getAggregateClass(pArc.kind) + " " + kind2class.getClass(pArc.kind);
        var lDoubleLine = [":>", "::", "<:>"].indexOf(pArc.kind) > -1;
        var lYTo = determineArcYTo(pArc, pY);
        var lArcGradient = (lYTo === 0) ? gChart.arcGradient : lYTo;

        pTo = renderutensils.determineArcXTo(pArc.kind, pFrom, pTo);

        if (pFrom === pTo) {
            lGroup.appendChild(
                createSelfRefArc(pArc.kind, pFrom, lYTo, lDoubleLine, pArc.linecolor, pY)
            );

            /* creates a label left aligned, a little above the arc*/
            var lTextWidth = 2 * entities.getDims().interEntitySpacing / 3;
            lGroup.appendChild(
                renderlabels.createLabel(
                    pArc,
                    {
                        x:pFrom + 1.5 * constants.LINE_WIDTH - (lTextWidth / 2),
                        y:pY - (gChart.arcRowHeight / 5) - constants.LINE_WIDTH / 2,
                        width:lTextWidth
                    },
                    _.defaults(
                        _.cloneDeep(pOptions),
                        {
                            alignLeft: true,
                            alignAbove: true,
                            ownBackground: true
                        }
                    )
                )
            );
        } else {
            var lLine = svgelementfactory.createLine(
                {xFrom: pFrom, yFrom: pY, xTo: pTo, yTo: pY + lArcGradient},
                {
                    class: lClass,
                    doubleLine: lDoubleLine
                }
            );
            markermanager.getAttributes(
                idmanager.get(), pArc.kind, pArc.linecolor, pFrom, pTo
            ).forEach(function(pAttribute){
                lLine.setAttribute(pAttribute.name, pAttribute.value);
            });
            lGroup.appendChild(lLine);

            /* create a label centered on the arc */
            lGroup.appendChild(
                renderlabels.createLabel(
                    pArc,
                    {x: pFrom, y: pY, width: pTo - pFrom},
                    _.defaults(
                        _.cloneDeep(pOptions),
                        {
                            alignAround: true,
                            alignAbove: (gChart.regularArcTextVerticalAlignment === "above"),
                            ownBackground: true
                        }
                    )
                )
            );
        }
        return lGroup;
    }

    /**
     * createLifeLinesText() - creates centered text for the current (most
     *     possibly empty) arc. If the arc has a from and a to, the function
     *     centers between these, otherwise it does so from 0 to the width of
     *     the rendered chart
     *
     * @param <string> - pId - unique identification of the text in the svg
     * @param <object> - pArc - the arc to render
     */
    function createLifeLinesText(pArc, pOAndD, pY) {
        var lArcStart = 0;
        var lArcEnd   = gChart.arcEndX;

        if (pArc.from && pArc.to) {
            lArcStart = pOAndD.from;
            lArcEnd   = pOAndD.to - pOAndD.from;
        }
        return renderlabels.createLabel(
            pArc,
            {x:lArcStart, y:pY, width:lArcEnd},
            {ownBackground:true, wordwraparcs: gChart.wordWrapArcs}
        );
    }

    /**
     * createComment() - creates an element representing a comment ('---')
     *
     * @param <string> - pId - the unique identification of the comment within the svg
     * @param <object> - pArc - the (comment) arc to render
     */
    function createComment(pArc, pOAndD, pY) {
        var lStartX = 0;
        var lEndX = gChart.arcEndX;
        var lClass = "comment";
        var lGroup = svgelementfactory.createGroup();

        if (pArc.from && pArc.to) {
            var lMaxDepthCorrection = gChart.maxDepth * 1 * constants.LINE_WIDTH;
            var lArcDepthCorrection = (gChart.maxDepth - pArc.depth) * 2 * constants.LINE_WIDTH;

            lStartX =
                (pOAndD.from -
                  (entities.getDims().interEntitySpacing + 2 * constants.LINE_WIDTH) / 2) -
                (lArcDepthCorrection - lMaxDepthCorrection);
            lEndX   =
                (pOAndD.to +
                  (entities.getDims().interEntitySpacing + 2 * constants.LINE_WIDTH) / 2) +
                (lArcDepthCorrection - lMaxDepthCorrection);
            lClass  = "inline_expression_divider";
        }
        var lLine =
            svgelementfactory.createLine(
                {
                    xFrom: lStartX,
                    yFrom: pY,
                    xTo: lEndX,
                    yTo: pY
                },
                {
                    class: lClass
                }
            );

        lGroup.appendChild(lLine);
        lGroup.appendChild(createLifeLinesText(pArc, pOAndD, pY));

        if (pArc.linecolor) {
            lLine.setAttribute("style", "stroke:" + pArc.linecolor + ";");
        }

        return lGroup;
    }

    function createInlineExpressionBox(pOAndD, pArc, pHeight, pY) {
        /* begin: same as createBox */
        var lMaxDepthCorrection = gChart.maxDepth * 2 * constants.LINE_WIDTH;
        var lWidth =
            (pOAndD.to - pOAndD.from) +
            entities.getDims().interEntitySpacing - 2 * constants.LINE_WIDTH - lMaxDepthCorrection; // px
        var lStart =
            pOAndD.from -
            ((entities.getDims().interEntitySpacing - 2 * constants.LINE_WIDTH - lMaxDepthCorrection) / 2);

        /* end: same as createBox */

        var lArcDepthCorrection = (gChart.maxDepth - pArc.depth) * 2 * constants.LINE_WIDTH;

        return svgelementfactory.createRect(
            {
                width: lWidth + lArcDepthCorrection * 2,
                height: pHeight ? pHeight : gChart.arcRowHeight - 2 * constants.LINE_WIDTH,
                x: lStart - lArcDepthCorrection,
                y: pY
            },
            "box inline_expression " + pArc.kind,
            pArc.linecolor,
            pArc.textbgcolor
        );
    }

    /**
     * creates an element representing a box (box, abox, rbox, note)
     * also (mis?) used for rendering inline expressions/ arc spanning arcs
     *
     * @param <string> - pId - the unique identification of the box within the svg
     * @param <number> - pFrom - the x coordinate to render the box from
     * @param <number> - pTo - the x coordinate to render te box to
     * @param <object> - pArc - the (box/ arc spanning) arc to render
     * @param <number> - pHeight - the height of the box to render. If not passed
     * takes the bounding box of the (rendered) label of the arc, taking care not
     * to get smaller than the default arc row height
     */
    function createBox(pOAndD, pArc, pY, pOptions) {
        /* begin: same as createInlineExpressionBox */
        var lMaxDepthCorrection = gChart.maxDepth * 2 * constants.LINE_WIDTH;
        var lWidth =
            (pOAndD.to - pOAndD.from) +
            entities.getDims().interEntitySpacing - 2 * constants.LINE_WIDTH - lMaxDepthCorrection; // px
        var lStart =
            pOAndD.from -
            ((entities.getDims().interEntitySpacing - 2 * constants.LINE_WIDTH - lMaxDepthCorrection) / 2);
        /* end: same as createInlineExpressionBox */

        var lGroup = svgelementfactory.createGroup();
        var lBox = {};
        var lTextGroup = renderlabels.createLabel(pArc, {x:lStart, y:pY, width:lWidth}, pOptions);
        var lTextBBox = svgutensils.getBBox(lTextGroup);
        var lHeight = Math.max(lTextBBox.height + 2 * constants.LINE_WIDTH, gChart.arcRowHeight - 2 * constants.LINE_WIDTH);
        var lBBox = {width: lWidth, height: lHeight, x: lStart, y: (pY - lHeight / 2)};

        switch (pArc.kind) {
        case ("rbox"):
            lBox = svgelementfactory.createRBox(lBBox, "box rbox", pArc.linecolor, pArc.textbgcolor);
            break;
        case ("abox"):
            lBox = svgelementfactory.createABox(lBBox, "box abox", pArc.linecolor, pArc.textbgcolor);
            break;
        case ("note"):
            lBox = svgelementfactory.createNote(lBBox, "box note", pArc.linecolor, pArc.textbgcolor);
            break;
        default:  // "box"
            lBox = svgelementfactory.createRect(lBBox, "box", pArc.linecolor, pArc.textbgcolor);
            break;
        }

        lGroup.appendChild(lBox);
        lGroup.appendChild(lTextGroup);

        return lGroup;
    }

    return {

        /**
         * removes the element with id pParentElementId from the DOM
         *
         * @param - {string} pParentElementId - the element the element with
         * the id mentioned above is supposed to be residing in
         * @param - {window} pWindow - the browser window object
         *
         */
        clean : function (pParentElementId, pWindow) {
            gChart.document = renderskeleton.init(pWindow);
            svgutensils.init(gChart.document);
            svgutensils.removeRenderedSVGFromElement(pParentElementId);
        },

        /**
         * renders the given abstract syntax tree pAST as svg
         * in the element with id pParentELementId in the window pWindow
         *
         * @param {object} pAST - the abstract syntax tree
         * @param {string} pSource - the source msc to embed in the svg
         * @param {string} pParentElementId - the id of the parent element in which
         * to put the __svg_output element
         * @param {window} pWindow - the browser window to put the svg in
         * @param {string} pStyleAdditions - valid css that augments the default style
         */
        renderAST : function (pAST, pSource, pParentElementId, pWindow, pStyleAdditions) {
            return _renderASTNew(
                pAST,
                pWindow,
                pParentElementId,
                {
                    source: pSource,
                    styleAdditions: pStyleAdditions
                }
            );
        },

        /**
        * renders the given abstract syntax tree pAST as svg
        * in the element with id pParentELementId in the window pWindow
        *
         * @param {object} pAST - the abstract syntax tree
         * @param {window} pWindow - the browser window to put the svg in
         * @param {string} pParentElementId - the id of the parent element in which
         * to put the __svg_output element
         * @param  {object} pOptions
         * - styleAdditions:  valid css that augments the default style
         * - additionalTemplate: a named (baked in) template. Current values:
         *  "inverted", "grayscaled"
         * - source: the source msc to embed in the svg
         * - mirrorEntitiesOnBottom: (boolean) whether or not to repeat entities
         *   on the bottom of the chart
         */
        renderASTNew : _renderASTNew
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore next */


define('utl/exporter',[], function() {
    "use strict";
    /* max length of an URL on github (4122)
     * "https://sverweij.github.io/".length (27) - 1
     */
    var MAX_LOCATION_LENGTH = 4094;

    function source2LocationString(pLocation, pSource, pLanguage){
        return pLocation.pathname +
                '?lang=' + pLanguage +
                '&msc=' + encodeURIComponent(pSource);
    }

    function sourceIsURLable(pLocation, pSource, pLanguage){
        return source2LocationString(pLocation, pSource, pLanguage).length < MAX_LOCATION_LENGTH;
    }

    return {
        toLocationString: function (pLocation, pSource, pLanguage) {
            var lSource = '# source too long for an URL';
            if (sourceIsURLable(pLocation, pSource, pLanguage)) {
                lSource = pSource;
            }
            return source2LocationString(pLocation, lSource, pLanguage);
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* global mscgen_js_config */
/* istanbul ignore next */


define('embedding/config',[], function() {
    "use strict";

    var gConfig = {
        defaultLanguage : "mscgen",
        parentElementPrefix : "mscgen_js-parent_",
        clickable : false,
        clickURL : "https://sverweij.github.io/mscgen_js/",
        loadFromSrcAttribute: false
    };

    function mergeConfig (pConfigBase, pConfigToMerge){
        Object.getOwnPropertyNames(pConfigToMerge).forEach(function(pAttribute){
            pConfigBase[pAttribute] = pConfigToMerge[pAttribute];
        });
    }

    return {
        getConfig: function(){
            if ('undefined' !== typeof (mscgen_js_config) && mscgen_js_config &&
                'object' === typeof (mscgen_js_config)){
                mergeConfig(gConfig, mscgen_js_config);
            }
            return gConfig;
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore next */


define('utl/tpl',[], function() {
    "use strict";

    return {
        applyTemplate: function applyTemplate (pTemplate, pReplacementPairs){
            var lRetval = pTemplate;

            if (!!pReplacementPairs) {
                Object.keys(pReplacementPairs).forEach(function(pKey){
                    lRetval =
                        lRetval.replace(
                            new RegExp("{" + pKey + "}", "g"),
                            pReplacementPairs[pKey]
                        );
                });
            }
            return lRetval;
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore next */


define('embedding/error-rendering',["../utl/tpl"], function(tpl) {
    "use strict";

    var TPL_ERR_LINENO = "<pre><div style='color: #d00'># ERROR on line {line}, column {col} - {message}</div>";
    var TPL_ERR = "<pre><div style='color: #d00'># ERROR {message}</div>";
    var TPL_MARKED_LINE = "<mark>{line}\n</mark>";
    var TPL_UNDERLINED_CHAR = "<span style='text-decoration:underline'>{char}</span>";
    /**
     * Given a Number, emits a String with that number in, left padded so the
     * string is pMaxWidth long. If the number doesn't fit within pMaxWidth
     * characters, just returns a String with that number in it
     *
     * @param {number} pNumber
     * @param {number} pMaxWidth
     * @return {string} - the formatted number
     */
    function formatNumber(pNumber, pMaxWidth) {
        var lRetval = pNumber.toString();
        var lPosLeft = pMaxWidth - lRetval.length;
        for (var i = 0; i < lPosLeft; i++) {
            lRetval = " " + lRetval;
        }
        return lRetval;
    }

    function formatLine(pLine, pLineNo){
        return formatNumber(pLineNo, 3) + " " + pLine;
    }

    function underlineCol(pLine, pCol){
        return pLine.split("").reduce(function(pPrev, pChar, pIndex){
            if (pIndex === pCol) {
                return pPrev + tpl.applyTemplate(
                    TPL_UNDERLINED_CHAR, {char: deHTMLize(pChar)}
                );
            }
            return pPrev + deHTMLize(pChar);
        }, "");
    }

    /**
     * returns a 'sanitized' version of the passed
     * string. Sanitization is <em>very barebones</em> at the moment
     * - it replaces < by &lt; so the browser won't start interpreting it
     * as html. I'd rather use something standard for this, but haven't
     * found it yet...
     */
    function deHTMLize(pString){
        return pString.replace(/</g, "&lt;");
    }

    return {
        formatNumber: formatNumber,
        deHTMLize: deHTMLize,
        renderError: function renderError(pSource, pErrorLocation, pMessage){
            var lErrorIntro = Boolean(pErrorLocation)
                ? tpl.applyTemplate(
                    TPL_ERR_LINENO, {
                        message: pMessage,
                        line: pErrorLocation.start.line,
                        col: pErrorLocation.start.column
                    })
                : tpl.applyTemplate(
                    TPL_ERR, {
                        message: pMessage
                    }
                );

            return pSource.split('\n').reduce(function(pPrev, pLine, pIndex) {
                if (!!pErrorLocation && pIndex === (pErrorLocation.start.line - 1)) {
                    return pPrev + tpl.applyTemplate(
                        TPL_MARKED_LINE, {
                            line:formatLine(underlineCol(pLine, pErrorLocation.start.column - 1), pIndex + 1)
                        }
                    );
                }
                return pPrev + deHTMLize(formatLine(pLine, pIndex + 1)) + '\n';
            }, lErrorIntro) + "</pre>";
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* istanbul ignore next */


define('utl/domutl',[], function(){
    "use strict";

    return {
        ajax : function (pURL, pSuccessFunction, pErrorFunction) {
            var lHttpRequest = new XMLHttpRequest();
            lHttpRequest.onreadystatechange = function onReadyStateChange(pEvent) {
                if (pEvent.target.readyState === XMLHttpRequest.DONE) {
                    if (200 === lHttpRequest.status) {
                        pSuccessFunction(pEvent);
                    } else {
                        pErrorFunction(pEvent);
                    }
                }
            };
            lHttpRequest.open('GET', pURL);
            lHttpRequest.responseType = "text";
            try {
                lHttpRequest.send();
            } catch (e) {
                pErrorFunction(e);
            }
        }
    };
});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
/* eslint max-params: 0 */
require([
    "./lib/mscgenjs-core/parse/xuparser",
    "./lib/mscgenjs-core/parse/msgennyparser",
    "./lib/mscgenjs-core/render/graphics/renderast",
    "./utl/exporter",
    "./embedding/config",
    "./embedding/error-rendering",
    "./utl/domutl",
    "./utl/tpl"
], function(mscparser, msgennyparser, mscrender, exp, conf, err, $, tpl) {

    var TPL_SPAN = "<span class='mscgen_js' {src} data-language='{lang}' " +
                   "data-named-style='{namedStyle}' " +
                   "data-regular-arc-text-vertical-alignment='{regularArcTextVerticalAlignment}' " +
                   "{mirrorEntities}>{msc}<span>";
    var TPL_SPAN_SRC = "data-src='{src}' ";
    var TPL_ERR_FILE_NOT_FOUND =
"ERROR: Could not find or open the URL '{url}' specified in the <code>data-src</code> attribute.";
    var TPL_ERR_FILE_LOADING_DISABLED =
"ERROR: Won't load the chart specified in <code>data-src='{url}'</code>, " +
"because loading from separate files is switched off in the mscgen_js " +
"configuration. <br><br>See " +
"<a href='https://sverweij.github.io/mscgen_js/embed.html#loading-from-separate-files'>" +
"Loading charts from separate files</a> in the mscgen_js embedding " +
"guide how to enable it."
;
    var MIME2LANG = {
        "text/x-mscgen"  : "mscgen",
        "text/x-msgenny" : "msgenny",
        "text/x-xu"      : "xu"
    };


    // BEGIN HACKS
    // rather doing anything on start, just expose the API I care about so I can use it elsewhere
    //start();
    window.msc = {
        mscparser,
        msgennyparser,
        mscrender
    };

    // END HACKS

    function start() {
        processScriptElements();

        var lClassElements = document.getElementsByClassName("mscgen_js");
        renderElementArray(lClassElements, 0);
        renderElementArray(document.getElementsByTagName("mscgen"), lClassElements.length);
    }

    function processScriptElements() {
        var lScripts = document.scripts;

        for (var i = 0; i < lScripts.length; i++){
            if (!!(MIME2LANG[lScripts[i].type]) && !lScripts[i].hasAttribute("data-renderedby")){
                lScripts[i].insertAdjacentHTML(
                    "afterend",
                    tpl.applyTemplate(
                        TPL_SPAN, {
                            src: lScripts[i].src ? tpl.applyTemplate(TPL_SPAN_SRC, {src: lScripts[i].src}) : "",
                            lang: MIME2LANG[lScripts[i].type] || conf.getConfig().defaultLanguage,
                            msc: lScripts[i].textContent.replace(/</g, "&lt;"),
                            mirrorEntities: getMirrorEntities(lScripts[i]) ? "data-mirror-entities='true'" : "",
                            namedStyle: getNamedStyle(lScripts[i]),
                            regularArcTextVerticalAlignment: getVerticalAlignment(lScripts[i])
                        }
                    )
                );
                lScripts[i].setAttribute("data-renderedby", "mscgen_js");
            }
        }
    }

    function renderElementArray(pMscGenElements, pStartIdAt){
        for (var i = 0; i < pMscGenElements.length; i++) {
            processElement(pMscGenElements[i], pStartIdAt + i);
        }
    }

    function processElement(pElement, pIndex) {
        if (!pElement.hasAttribute('data-renderedby')) {
            renderElement(pElement, pIndex);
        }
    }

    function renderElementError(pElement, pString) {
        pElement.innerHTML =
            tpl.applyTemplate(
                "<div style='color: #d00'>{string}</div>",
                {string:pString}
            );
    }

    function renderElement (pElement, pIndex){
        setElementId(pElement, pIndex);
        pElement.setAttribute("data-renderedby", "mscgen_js");
        if (conf.getConfig().loadFromSrcAttribute && !!pElement.getAttribute("data-src")){
            $.ajax(
                pElement.getAttribute("data-src"),
                function onSuccess(pEvent) {
                    parseAndRender(pElement, pEvent.target.response);
                },
                function onError() {
                    renderElementError(
                        pElement,
                        tpl.applyTemplate(
                            TPL_ERR_FILE_NOT_FOUND,
                            {url: pElement.getAttribute("data-src")}
                        )
                    );
                }
            );
        } else if (!conf.getConfig().loadFromSrcAttribute && !!pElement.getAttribute("data-src")){
            renderElementError(
                pElement,
                tpl.applyTemplate(
                    TPL_ERR_FILE_LOADING_DISABLED,
                    {url: pElement.getAttribute("data-src")}
                )
            );
        } else {
            parseAndRender(pElement, pElement.textContent);
        }
    }

    function betterParseAndRender(targetElem, textContent, type) {

    }

    function parseAndRender(pElement, pSource){
        var lLanguage = getLanguage(pElement);
        var lAST      = getAST(pSource, lLanguage);

        if (lAST.entities) {
            render(
                lAST,
                pElement.id,
                pSource,
                lLanguage,
                getMirrorEntities(pElement),
                getNamedStyle(pElement),
                getVerticalAlignment(pElement)
            );
        } else {
            pElement.innerHTML = err.renderError(pSource, lAST.location, lAST.message);
        }
    }

    function renderLink(pSource, pLanguage, pId){
        var lLocation = {
            pathname: "index.html"
        };

        var lLink = document.createElement("a");
        lLink.setAttribute(
            "href",
            conf.getConfig().clickURL + exp.toLocationString(lLocation, pSource, pLanguage)
        );
        lLink.setAttribute("id", pId + "link");
        lLink.setAttribute("style", "text-decoration: none;");
        lLink.setAttribute("title", "click to edit in the mscgen_js interpreter");
        return lLink;
    }

    function setElementId(pElement, pIndex) {
        if (!pElement.id) {
            pElement.id = conf.getConfig().parentElementPrefix + pIndex.toString();
        }
    }

    function getLanguage(pElement) {
        /* the way to do it, but doesn't work in IE:
           lLanguage = pElement.dataset.language;
         */
        var lLanguage = pElement.getAttribute('data-language');
        if (!lLanguage) {
            lLanguage = conf.getConfig().defaultLanguage;
        }
        return lLanguage;
    }

    function getMirrorEntities(pElement) {
        var lMirrorEntities = pElement.getAttribute('data-mirror-entities');

        if (lMirrorEntities && lMirrorEntities === "true") {
            return true;
        }
        return false;
    }

    function getNamedStyle(pElement) {
        return pElement.getAttribute('data-named-style') || 'basic';
    }

    function getVerticalAlignment(pElement) {
        return pElement.getAttribute('data-regular-arc-text-vertical-alignment') || 'middle';
    }

    function getAST(pText, pLanguage) {
        var lAST = {};
        try {
            if ("msgenny" === pLanguage) {
                lAST = msgennyparser.parse(pText);
            } else if ("json" === pLanguage) {
                lAST = JSON.parse(pText);
            } else {
                lAST = mscparser.parse(pText);
            }
        } catch (e) {
            return e;
        }
        return lAST;
    }

    function render(
        pAST,
        pElementId,
        pSource,
        pLanguage,
        pMirrorEntities,
        pNamedStyle,
        pRegularArcTextVerticalAlignment
    ) {
        var lElement = document.getElementById(pElementId);
        lElement.innerHTML = "";

        if (true === conf.getConfig().clickable){
            lElement.appendChild(renderLink(pSource, pLanguage, pElementId));
            pElementId += "link";
        }
        mscrender.clean(pElementId, window);
        mscrender.renderASTNew(
            pAST,
            window,
            pElementId,
            {
                source                 : pSource,
                additionalTemplate     : pNamedStyle,
                mirrorEntitiesOnBottom : pMirrorEntities,
                regularArcTextVerticalAlignment: pRegularArcTextVerticalAlignment
            }
        );
    }

});
/*
 This file is part of mscgen_js.

 mscgen_js is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 mscgen_js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with mscgen_js.  If not, see <http://www.gnu.org/licenses/>.
 */
;
define("mscgen-inpage", function(){});

}());