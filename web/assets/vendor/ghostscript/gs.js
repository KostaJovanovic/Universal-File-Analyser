
var Module = (() => {
  var _scriptDir = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : undefined;
  if (typeof __filename !== 'undefined') _scriptDir = _scriptDir || __filename;
  return (
function(Module) {
  Module = Module || {};


var d;
d || (d = typeof Module !== 'undefined' ? Module : {});
var aa, ba;
d.ready = new Promise(function(a, b) {
  aa = a;
  ba = b;
});
Object.getOwnPropertyDescriptor(d.ready, "_main") || (Object.defineProperty(d.ready, "_main", {configurable:!0, get:function() {
  h("You are getting _main on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}), Object.defineProperty(d.ready, "_main", {configurable:!0, set:function() {
  h("You are setting _main on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}));
Object.getOwnPropertyDescriptor(d.ready, "___stdio_exit") || (Object.defineProperty(d.ready, "___stdio_exit", {configurable:!0, get:function() {
  h("You are getting ___stdio_exit on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}), Object.defineProperty(d.ready, "___stdio_exit", {configurable:!0, set:function() {
  h("You are setting ___stdio_exit on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}));
Object.getOwnPropertyDescriptor(d.ready, "onRuntimeInitialized") || (Object.defineProperty(d.ready, "onRuntimeInitialized", {configurable:!0, get:function() {
  h("You are getting onRuntimeInitialized on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}), Object.defineProperty(d.ready, "onRuntimeInitialized", {configurable:!0, set:function() {
  h("You are setting onRuntimeInitialized on the Promise object, instead of the instance. Use .then() to get called back with the instance, see the MODULARIZE docs in src/settings.js");
}}));
d.noInitialRun = !0;
var ca = Object.assign({}, d), da = [], ea = "./this.program", fa = (a, b) => {
  throw b;
}, ha = "object" == typeof window, k = "function" == typeof importScripts, p = "object" == typeof process && "object" == typeof process.versions && "string" == typeof process.versions.node, ia = !ha && !p && !k;
if (d.ENVIRONMENT) {
  throw Error("Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)");
}
var q = "", ja, ka, la;
function ma(a) {
  if (!(a instanceof na)) {
    var b = a;
    a && "object" == typeof a && a.stack && (b = [a, a.stack]);
    v("exiting due to exception: " + b);
  }
}
var fs, oa, pa;
if (p) {
  if ("object" != typeof process || "function" != typeof require) {
    throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
  }
  q = k ? require("path").dirname(q) + "/" : __dirname + "/";
  pa = () => {
    oa || (fs = require("fs"), oa = require("path"));
  };
  ja = function(a, b) {
    pa();
    a = oa.normalize(a);
    return fs.readFileSync(a, b ? void 0 : "utf8");
  };
  la = a => {
    a = ja(a, !0);
    a.buffer || (a = new Uint8Array(a));
    assert(a.buffer);
    return a;
  };
  ka = (a, b, c) => {
    pa();
    a = oa.normalize(a);
    fs.readFile(a, function(e, f) {
      e ? c(e) : b(f.buffer);
    });
  };
  1 < process.argv.length && (ea = process.argv[1].replace(/\\/g, "/"));
  da = process.argv.slice(2);
  process.on("uncaughtException", function(a) {
    if (!(a instanceof na)) {
      throw a;
    }
  });
  process.on("unhandledRejection", function(a) {
    throw a;
  });
  fa = (a, b) => {
    if (noExitRuntime) {
      throw process.exitCode = a, b;
    }
    ma(b);
    process.exit(a);
  };
  d.inspect = function() {
    return "[Emscripten Module object]";
  };
} else if (ia) {
  if ("object" == typeof process && "function" === typeof require || "object" == typeof window || "function" == typeof importScripts) {
    throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
  }
  "undefined" != typeof read && (ja = function(a) {
    return read(a);
  });
  la = function(a) {
    if ("function" == typeof readbuffer) {
      return new Uint8Array(readbuffer(a));
    }
    a = read(a, "binary");
    assert("object" == typeof a);
    return a;
  };
  ka = function(a, b) {
    setTimeout(() => b(la(a)), 0);
  };
  "undefined" != typeof scriptArgs ? da = scriptArgs : "undefined" != typeof arguments && (da = arguments);
  "function" == typeof quit && (fa = (a, b) => {
    ma(b);
    quit(a);
  });
  "undefined" != typeof print && ("undefined" == typeof console && (console = {}), console.log = print, console.warn = console.error = "undefined" != typeof printErr ? printErr : print);
} else if (ha || k) {
  k ? q = self.location.href : "undefined" != typeof document && document.currentScript && (q = document.currentScript.src);
  _scriptDir && (q = _scriptDir);
  0 !== q.indexOf("blob:") ? q = q.substr(0, q.replace(/[?#].*/, "").lastIndexOf("/") + 1) : q = "";
  if ("object" != typeof window && "function" != typeof importScripts) {
    throw Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
  }
  ja = a => {
    var b = new XMLHttpRequest();
    b.open("GET", a, !1);
    b.send(null);
    return b.responseText;
  };
  k && (la = a => {
    var b = new XMLHttpRequest();
    b.open("GET", a, !1);
    b.responseType = "arraybuffer";
    b.send(null);
    return new Uint8Array(b.response);
  });
  ka = (a, b, c) => {
    var e = new XMLHttpRequest();
    e.open("GET", a, !0);
    e.responseType = "arraybuffer";
    e.onload = () => {
      200 == e.status || 0 == e.status && e.response ? b(e.response) : c();
    };
    e.onerror = c;
    e.send(null);
  };
} else {
  throw Error("environment detection error");
}
var w = console.log.bind(console), v = console.warn.bind(console);
Object.assign(d, ca);
ca = null;
A("arguments", "arguments_");
A("thisProgram", "thisProgram");
A("quit", "quit_");
assert("undefined" == typeof d.memoryInitializerPrefixURL, "Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead");
assert("undefined" == typeof d.pthreadMainPrefixURL, "Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead");
assert("undefined" == typeof d.cdInitializerPrefixURL, "Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead");
assert("undefined" == typeof d.filePackagePrefixURL, "Module.filePackagePrefixURL option was removed, use Module.locateFile instead");
assert("undefined" == typeof d.read, "Module.read option was removed (modify read_ in JS)");
assert("undefined" == typeof d.readAsync, "Module.readAsync option was removed (modify readAsync in JS)");
assert("undefined" == typeof d.readBinary, "Module.readBinary option was removed (modify readBinary in JS)");
assert("undefined" == typeof d.setWindowTitle, "Module.setWindowTitle option was removed (modify setWindowTitle in JS)");
assert("undefined" == typeof d.TOTAL_MEMORY, "Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY");
A("read", "read_");
A("readAsync", "readAsync");
A("readBinary", "readBinary");
A("setWindowTitle", "setWindowTitle");
assert(!ia, "shell environment detected but not enabled at build time.  Add 'shell' to `-sENVIRONMENT` to enable.");
function qa(a) {
  ra || (ra = {});
  ra[a] || (ra[a] = 1, v(a));
}
var ra;
function A(a, b) {
  Object.getOwnPropertyDescriptor(d, a) || Object.defineProperty(d, a, {configurable:!0, get:function() {
    h("Module." + a + " has been replaced with plain " + b + " (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)");
  }});
}
function y(a) {
  Object.getOwnPropertyDescriptor(d, a) && h("`Module." + a + "` was supplied but `" + a + "` not included in INCOMING_MODULE_JS_API");
}
function sa(a, b) {
  a = "'" + a + "' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)";
  b && (a += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you");
  return a;
}
function ta(a) {
  Object.getOwnPropertyDescriptor(d, a) || Object.defineProperty(d, a, {configurable:!0, get:function() {
    h(sa(a, !1));
  }});
}
function C(a, b) {
  Object.getOwnPropertyDescriptor(d, a) || (d[a] = () => h(sa(a, b)));
}
var ua = 0;
A("wasmBinary", "wasmBinary");
var noExitRuntime = !0;
A("noExitRuntime", "noExitRuntime");
"object" != typeof WebAssembly && h("no native wasm support detected");
var va, wa = !1, xa;
function assert(a, b) {
  a || h("Assertion failed" + (b ? ": " + b : ""));
}
var ya = "undefined" != typeof TextDecoder ? new TextDecoder("utf8") : void 0;
function za(a, b) {
  for (var c = b + NaN, e = b; a[e] && !(e >= c);) {
    ++e;
  }
  if (16 < e - b && a.buffer && ya) {
    return ya.decode(a.subarray(b, e));
  }
  for (c = ""; b < e;) {
    var f = a[b++];
    if (f & 128) {
      var g = a[b++] & 63;
      if (192 == (f & 224)) {
        c += String.fromCharCode((f & 31) << 6 | g);
      } else {
        var l = a[b++] & 63;
        224 == (f & 240) ? f = (f & 15) << 12 | g << 6 | l : (240 != (f & 248) && qa("Invalid UTF-8 leading byte 0x" + f.toString(16) + " encountered when deserializing a UTF-8 string in wasm memory to a JS string!"), f = (f & 7) << 18 | g << 12 | l << 6 | a[b++] & 63);
        65536 > f ? c += String.fromCharCode(f) : (f -= 65536, c += String.fromCharCode(55296 | f >> 10, 56320 | f & 1023));
      }
    } else {
      c += String.fromCharCode(f);
    }
  }
  return c;
}
function D(a) {
  return a ? za(Aa, a) : "";
}
function Ba(a, b, c, e) {
  if (!(0 < e)) {
    return 0;
  }
  var f = c;
  e = c + e - 1;
  for (var g = 0; g < a.length; ++g) {
    var l = a.charCodeAt(g);
    if (55296 <= l && 57343 >= l) {
      var n = a.charCodeAt(++g);
      l = 65536 + ((l & 1023) << 10) | n & 1023;
    }
    if (127 >= l) {
      if (c >= e) {
        break;
      }
      b[c++] = l;
    } else {
      if (2047 >= l) {
        if (c + 1 >= e) {
          break;
        }
        b[c++] = 192 | l >> 6;
      } else {
        if (65535 >= l) {
          if (c + 2 >= e) {
            break;
          }
          b[c++] = 224 | l >> 12;
        } else {
          if (c + 3 >= e) {
            break;
          }
          1114111 < l && qa("Invalid Unicode code point 0x" + l.toString(16) + " encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).");
          b[c++] = 240 | l >> 18;
          b[c++] = 128 | l >> 12 & 63;
        }
        b[c++] = 128 | l >> 6 & 63;
      }
      b[c++] = 128 | l & 63;
    }
  }
  b[c] = 0;
  return c - f;
}
function Ca(a) {
  for (var b = 0, c = 0; c < a.length; ++c) {
    var e = a.charCodeAt(c);
    55296 <= e && 57343 >= e && (e = 65536 + ((e & 1023) << 10) | a.charCodeAt(++c) & 1023);
    127 >= e ? ++b : b = 2047 >= e ? b + 2 : 65535 >= e ? b + 3 : b + 4;
  }
  return b;
}
"undefined" != typeof TextDecoder && new TextDecoder("utf-16le");
function Da(a) {
  var b = Ca(a) + 1, c = Ea(b);
  c && Ba(a, E, c, b);
  return c;
}
function Fa(a) {
  var b = Ca(a) + 1, c = Ga(b);
  Ba(a, E, c, b);
  return c;
}
function Ha(a, b) {
  assert(0 <= a.length, "writeArrayToMemory array must have a length (should be an array or typed array)");
  E.set(a, b);
}
var Ia, E, Aa, Ja, G, H, Ka;
function La() {
  var a = va.buffer;
  Ia = a;
  d.HEAP8 = E = new Int8Array(a);
  d.HEAP16 = Ja = new Int16Array(a);
  d.HEAP32 = G = new Int32Array(a);
  d.HEAPU8 = Aa = new Uint8Array(a);
  d.HEAPU16 = new Uint16Array(a);
  d.HEAPU32 = H = new Uint32Array(a);
  d.HEAPF32 = new Float32Array(a);
  d.HEAPF64 = new Float64Array(a);
  d.HEAP64 = Ka = new BigInt64Array(a);
  d.HEAPU64 = new BigUint64Array(a);
}
d.TOTAL_STACK && assert(5242880 === d.TOTAL_STACK, "the stack size can no longer be determined at runtime");
A("INITIAL_MEMORY", "INITIAL_MEMORY");
assert(!0, "INITIAL_MEMORY should be larger than TOTAL_STACK, was 67108864! (TOTAL_STACK=5242880)");
assert("undefined" != typeof Int32Array && "undefined" !== typeof Float64Array && void 0 != Int32Array.prototype.subarray && void 0 != Int32Array.prototype.set, "JS engine does not provide full typed array support");
assert(!d.wasmMemory, "Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally");
assert(!0, "Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically");
var Ma;
function Na() {
  var a = Oa();
  assert(0 == (a & 3));
  G[a >> 2] = 34821223;
  G[a + 4 >> 2] = 2310721022;
  H[0] = 1668509029;
}
function Pa() {
  if (!wa) {
    var a = Oa(), b = H[a >> 2];
    a = H[a + 4 >> 2];
    34821223 == b && 2310721022 == a || h("Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x2135467, but received 0x" + a.toString(16) + " 0x" + b.toString(16));
    1668509029 !== H[0] && h("Runtime error: The application has corrupted its heap memory area (address zero)!");
  }
}
var Qa = new Int16Array(1), Ra = new Int8Array(Qa.buffer);
Qa[0] = 25459;
if (115 !== Ra[0] || 99 !== Ra[1]) {
  throw "Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)";
}
var Sa = [], Ta = [], Ua = [], Va = [], Wa = !1;
assert(Math.imul, "This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
assert(Math.fround, "This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
assert(Math.clz32, "This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
assert(Math.trunc, "This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill");
var Xa = 0, I = null, Ya = null, Za = {};
function $a(a) {
  for (var b = a;;) {
    if (!Za[a]) {
      return a;
    }
    a = b + Math.random();
  }
}
function ab(a) {
  Xa++;
  a ? (assert(!Za[a]), Za[a] = 1, null === I && "undefined" != typeof setInterval && (I = setInterval(function() {
    if (wa) {
      clearInterval(I), I = null;
    } else {
      var b = !1, c;
      for (c in Za) {
        b || (b = !0, v("still waiting on run dependencies:")), v("dependency: " + c);
      }
      b && v("(end of list)");
    }
  }, 10000))) : v("warning: run dependency added without ID");
}
function bb(a) {
  Xa--;
  a ? (assert(Za[a]), delete Za[a]) : v("warning: run dependency removed without ID");
  0 == Xa && (null !== I && (clearInterval(I), I = null), Ya && (a = Ya, Ya = null, a()));
}
function h(a) {
  a = "Aborted(" + a + ")";
  v(a);
  wa = !0;
  xa = 1;
  a = new WebAssembly.RuntimeError(a);
  ba(a);
  throw a;
}
function cb() {
  return J.startsWith("data:application/octet-stream;base64,");
}
function M(a) {
  return function() {
    var b = d.asm;
    assert(Wa, "native function `" + a + "` called before runtime initialization");
    b[a] || assert(b[a], "exported native function `" + a + "` not found");
    return b[a].apply(null, arguments);
  };
}
var J;
J = "gs.wasm";
if (!cb()) {
  var db = J;
  J = d.locateFile ? d.locateFile(db, q) : q + db;
}
function eb() {
  var a = J;
  try {
    if (la) {
      return la(a);
    }
    throw "both async and sync fetching of the wasm failed";
  } catch (b) {
    h(b);
  }
}
function fb() {
  if (ha || k) {
    if ("function" == typeof fetch && !J.startsWith("file://")) {
      return fetch(J, {credentials:"same-origin"}).then(function(a) {
        if (!a.ok) {
          throw "failed to load wasm binary file at '" + J + "'";
        }
        return a.arrayBuffer();
      }).catch(function() {
        return eb();
      });
    }
    if (ka) {
      return new Promise(function(a, b) {
        ka(J, function(c) {
          a(new Uint8Array(c));
        }, b);
      });
    }
  }
  return Promise.resolve().then(function() {
    return eb();
  });
}
function gb(a) {
  for (; 0 < a.length;) {
    var b = a.shift();
    if ("function" == typeof b) {
      b(d);
    } else {
      var c = b.sc;
      if ("number" == typeof c) {
        if (void 0 === b.Ga) {
          throw 'Internal Error! Attempted to invoke wasm function pointer with signature "v", but no such functions have gotten exported!';
        }
        dynCall_vi.apply(null, [c, b.Ga]);
      } else {
        c(void 0 === b.Ga ? null : b.Ga);
      }
    }
  }
}
function hb(a) {
  return a.replace(/\b_Z[\w\d_]+/g, function(b) {
    qa("warning: build with -sDEMANGLE_SUPPORT to link in libcxxabi demangling");
    return b === b ? b : b + " [" + b + "]";
  });
}
var ib = 0;
function jb(a) {
  this.N = a - 24;
  this.Yb = function(b) {
    H[this.N + 4 >> 2] = b;
  };
  this.La = function() {
    return H[this.N + 4 >> 2];
  };
  this.Qb = function(b) {
    H[this.N + 8 >> 2] = b;
  };
  this.Rb = function() {
    G[this.N >> 2] = 0;
  };
  this.Nb = function() {
    E[this.N + 12 >> 0] = 0;
  };
  this.Sb = function() {
    E[this.N + 13 >> 0] = 0;
  };
  this.Y = function(b, c) {
    this.V(0);
    this.Yb(b);
    this.Qb(c);
    this.Rb();
    this.Nb();
    this.Sb();
  };
  this.V = function(b) {
    H[this.N + 16 >> 2] = b;
  };
}
var kb = (a, b) => {
  for (var c = 0, e = a.length - 1; 0 <= e; e--) {
    var f = a[e];
    "." === f ? a.splice(e, 1) : ".." === f ? (a.splice(e, 1), c++) : c && (a.splice(e, 1), c--);
  }
  if (b) {
    for (; c; c--) {
      a.unshift("..");
    }
  }
  return a;
}, N = a => {
  var b = "/" === a.charAt(0), c = "/" === a.substr(-1);
  (a = kb(a.split("/").filter(e => !!e), !b).join("/")) || b || (a = ".");
  a && c && (a += "/");
  return (b ? "/" : "") + a;
}, lb = a => {
  var b = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);
  a = b[0];
  b = b[1];
  if (!a && !b) {
    return ".";
  }
  b && (b = b.substr(0, b.length - 1));
  return a + b;
}, O = a => {
  if ("/" === a) {
    return "/";
  }
  a = N(a);
  a = a.replace(/\/$/, "");
  var b = a.lastIndexOf("/");
  return -1 === b ? a : a.substr(b + 1);
};
function mb() {
  var a = Array.prototype.slice.call(arguments, 0);
  return N(a.join("/"));
}
var P = (a, b) => N(a + "/" + b);
function nb() {
  if ("object" == typeof crypto && "function" == typeof crypto.getRandomValues) {
    var a = new Uint8Array(1);
    return function() {
      crypto.getRandomValues(a);
      return a[0];
    };
  }
  if (p) {
    try {
      var b = require("crypto");
      return function() {
        return b.randomBytes(1)[0];
      };
    } catch (c) {
    }
  }
  return function() {
    h("no cryptographic support found for randomDevice. consider polyfilling it if you want to use something insecure like Math.random(), e.g. put this in a --pre-js: var crypto = { getRandomValues: function(array) { for (var i = 0; i < array.length; i++) array[i] = (Math.random()*256)|0 } };");
  };
}
function ob() {
  for (var a = "", b = !1, c = arguments.length - 1; -1 <= c && !b; c--) {
    b = 0 <= c ? arguments[c] : Q.cwd();
    if ("string" != typeof b) {
      throw new TypeError("Arguments to path.resolve must be strings");
    }
    if (!b) {
      return "";
    }
    a = b + "/" + a;
    b = "/" === b.charAt(0);
  }
  a = kb(a.split("/").filter(e => !!e), !b).join("/");
  return (b ? "/" : "") + a || ".";
}
var pb = (a, b) => {
  function c(l) {
    for (var n = 0; n < l.length && "" === l[n]; n++) {
    }
    for (var t = l.length - 1; 0 <= t && "" === l[t]; t--) {
    }
    return n > t ? [] : l.slice(n, t - n + 1);
  }
  a = ob(a).substr(1);
  b = ob(b).substr(1);
  a = c(a.split("/"));
  b = c(b.split("/"));
  for (var e = Math.min(a.length, b.length), f = e, g = 0; g < e; g++) {
    if (a[g] !== b[g]) {
      f = g;
      break;
    }
  }
  e = [];
  for (g = f; g < a.length; g++) {
    e.push("..");
  }
  e = e.concat(b.slice(f));
  return e.join("/");
}, qb = [];
function rb(a, b) {
  qb[a] = {input:[], output:[], ia:b};
  Q.Wa(a, sb);
}
var sb = {open:function(a) {
  var b = qb[a.node.rdev];
  if (!b) {
    throw new Q.g(43);
  }
  a.tty = b;
  a.seekable = !1;
}, close:function(a) {
  a.tty.ia.flush(a.tty);
}, flush:function(a) {
  a.tty.ia.flush(a.tty);
}, read:function(a, b, c, e) {
  if (!a.tty || !a.tty.ia.lb) {
    throw new Q.g(60);
  }
  for (var f = 0, g = 0; g < e; g++) {
    try {
      var l = a.tty.ia.lb(a.tty);
    } catch (n) {
      throw new Q.g(29);
    }
    if (void 0 === l && 0 === f) {
      throw new Q.g(6);
    }
    if (null === l || void 0 === l) {
      break;
    }
    f++;
    b[c + g] = l;
  }
  f && (a.node.timestamp = Date.now());
  return f;
}, write:function(a, b, c, e) {
  if (!a.tty || !a.tty.ia.Sa) {
    throw new Q.g(60);
  }
  try {
    for (var f = 0; f < e; f++) {
      a.tty.ia.Sa(a.tty, b[c + f]);
    }
  } catch (g) {
    throw new Q.g(29);
  }
  e && (a.node.timestamp = Date.now());
  return f;
}}, ub = {lb:function(a) {
  if (!a.input.length) {
    var b = null;
    if (p) {
      var c = Buffer.alloc(256), e = 0;
      try {
        e = fs.readSync(process.stdin.fd, c, 0, 256, -1);
      } catch (f) {
        if (f.toString().includes("EOF")) {
          e = 0;
        } else {
          throw f;
        }
      }
      0 < e ? b = c.slice(0, e).toString("utf-8") : b = null;
    } else {
      "undefined" != typeof window && "function" == typeof window.prompt ? (b = window.prompt("Input: "), null !== b && (b += "\n")) : "function" == typeof readline && (b = readline(), null !== b && (b += "\n"));
    }
    if (!b) {
      return null;
    }
    a.input = tb(b, !0);
  }
  return a.input.shift();
}, Sa:function(a, b) {
  null === b || 10 === b ? (w(za(a.output, 0)), a.output = []) : 0 != b && a.output.push(b);
}, flush:function(a) {
  a.output && 0 < a.output.length && (w(za(a.output, 0)), a.output = []);
}}, vb = {Sa:function(a, b) {
  null === b || 10 === b ? (v(za(a.output, 0)), a.output = []) : 0 != b && a.output.push(b);
}, flush:function(a) {
  a.output && 0 < a.output.length && (v(za(a.output, 0)), a.output = []);
}};
function wb() {
  h("internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported");
}
var R = {M:null, m:function() {
  return R.createNode(null, "/", 16895, 0);
}, createNode:function(a, b, c, e) {
  if (Q.Ob(c) || Q.isFIFO(c)) {
    throw new Q.g(63);
  }
  R.M || (R.M = {dir:{node:{D:R.h.D, A:R.h.A, lookup:R.h.lookup, I:R.h.I, rename:R.h.rename, unlink:R.h.unlink, rmdir:R.h.rmdir, readdir:R.h.readdir, symlink:R.h.symlink}, stream:{C:R.i.C}}, file:{node:{D:R.h.D, A:R.h.A}, stream:{C:R.i.C, read:R.i.read, write:R.i.write, ma:R.i.ma, ga:R.i.ga, ha:R.i.ha}}, link:{node:{D:R.h.D, A:R.h.A, readlink:R.h.readlink}, stream:{}}, bb:{node:{D:R.h.D, A:R.h.A}, stream:Q.zb}});
  c = Q.createNode(a, b, c, e);
  Q.v(c.mode) ? (c.h = R.M.dir.node, c.i = R.M.dir.stream, c.j = {}) : Q.isFile(c.mode) ? (c.h = R.M.file.node, c.i = R.M.file.stream, c.s = 0, c.j = null) : Q.T(c.mode) ? (c.h = R.M.link.node, c.i = R.M.link.stream) : Q.na(c.mode) && (c.h = R.M.bb.node, c.i = R.M.bb.stream);
  c.timestamp = Date.now();
  a && (a.j[b] = c, a.timestamp = c.timestamp);
  return c;
}, uc:function(a) {
  return a.j ? a.j.subarray ? a.j.subarray(0, a.s) : new Uint8Array(a.j) : new Uint8Array(0);
}, hb:function(a, b) {
  var c = a.j ? a.j.length : 0;
  c >= b || (b = Math.max(b, c * (1048576 > c ? 2.0 : 1.125) >>> 0), 0 != c && (b = Math.max(b, 256)), c = a.j, a.j = new Uint8Array(b), 0 < a.s && a.j.set(c.subarray(0, a.s), 0));
}, cc:function(a, b) {
  if (a.s != b) {
    if (0 == b) {
      a.j = null, a.s = 0;
    } else {
      var c = a.j;
      a.j = new Uint8Array(b);
      c && a.j.set(c.subarray(0, Math.min(b, a.s)));
      a.s = b;
    }
  }
}, h:{D:function(a) {
  var b = {};
  b.dev = Q.na(a.mode) ? a.id : 1;
  b.ino = a.id;
  b.mode = a.mode;
  b.nlink = 1;
  b.uid = 0;
  b.gid = 0;
  b.rdev = a.rdev;
  Q.v(a.mode) ? b.size = 4096 : Q.isFile(a.mode) ? b.size = a.s : Q.T(a.mode) ? b.size = a.link.length : b.size = 0;
  b.atime = new Date(a.timestamp);
  b.mtime = new Date(a.timestamp);
  b.ctime = new Date(a.timestamp);
  b.P = 4096;
  b.blocks = Math.ceil(b.size / b.P);
  return b;
}, A:function(a, b) {
  void 0 !== b.mode && (a.mode = b.mode);
  void 0 !== b.timestamp && (a.timestamp = b.timestamp);
  void 0 !== b.size && R.cc(a, b.size);
}, lookup:function() {
  throw Q.Ka[44];
}, I:function(a, b, c, e) {
  return R.createNode(a, b, c, e);
}, rename:function(a, b, c) {
  if (Q.v(a.mode)) {
    try {
      var e = Q.K(b, c);
    } catch (g) {
    }
    if (e) {
      for (var f in e.j) {
        throw new Q.g(55);
      }
    }
  }
  delete a.parent.j[a.name];
  a.parent.timestamp = Date.now();
  a.name = c;
  b.j[c] = a;
  b.timestamp = a.parent.timestamp;
  a.parent = b;
}, unlink:function(a, b) {
  delete a.j[b];
  a.timestamp = Date.now();
}, rmdir:function(a, b) {
  var c = Q.K(a, b), e;
  for (e in c.j) {
    throw new Q.g(55);
  }
  delete a.j[b];
  a.timestamp = Date.now();
}, readdir:function(a) {
  var b = [".", ".."], c;
  for (c in a.j) {
    a.j.hasOwnProperty(c) && b.push(c);
  }
  return b;
}, symlink:function(a, b, c) {
  a = R.createNode(a, b, 41471, 0);
  a.link = c;
  return a;
}, readlink:function(a) {
  if (!Q.T(a.mode)) {
    throw new Q.g(28);
  }
  return a.link;
}}, i:{read:function(a, b, c, e, f) {
  var g = a.node.j;
  if (f >= a.node.s) {
    return 0;
  }
  a = Math.min(a.node.s - f, e);
  assert(0 <= a);
  if (8 < a && g.subarray) {
    b.set(g.subarray(f, f + a), c);
  } else {
    for (e = 0; e < a; e++) {
      b[c + e] = g[f + e];
    }
  }
  return a;
}, write:function(a, b, c, e, f, g) {
  assert(!(b instanceof ArrayBuffer));
  b.buffer === E.buffer && (g = !1);
  if (!e) {
    return 0;
  }
  a = a.node;
  a.timestamp = Date.now();
  if (b.subarray && (!a.j || a.j.subarray)) {
    if (g) {
      return assert(0 === f, "canOwn must imply no weird position inside the file"), a.j = b.subarray(c, c + e), a.s = e;
    }
    if (0 === a.s && 0 === f) {
      return a.j = b.slice(c, c + e), a.s = e;
    }
    if (f + e <= a.s) {
      return a.j.set(b.subarray(c, c + e), f), e;
    }
  }
  R.hb(a, f + e);
  if (a.j.subarray && b.subarray) {
    a.j.set(b.subarray(c, c + e), f);
  } else {
    for (g = 0; g < e; g++) {
      a.j[f + g] = b[c + g];
    }
  }
  a.s = Math.max(a.s, f + e);
  return e;
}, C:function(a, b, c) {
  1 === c ? b += a.position : 2 === c && Q.isFile(a.node.mode) && (b += a.node.s);
  if (0 > b) {
    throw new Q.g(28);
  }
  return b;
}, ma:function(a, b, c) {
  R.hb(a.node, b + c);
  a.node.s = Math.max(a.node.s, b + c);
}, ga:function(a, b, c, e, f, g) {
  if (0 !== b) {
    throw new Q.g(28);
  }
  if (!Q.isFile(a.node.mode)) {
    throw new Q.g(43);
  }
  a = a.node.j;
  if (g & 2 || a.buffer !== Ia) {
    if (0 < e || e + c < a.length) {
      a.subarray ? a = a.subarray(e, e + c) : a = Array.prototype.slice.call(a, e, e + c);
    }
    e = !0;
    c = wb();
    if (!c) {
      throw new Q.g(48);
    }
    E.set(a, c);
  } else {
    e = !1, c = a.byteOffset;
  }
  return {N:c, wb:e};
}, ha:function(a, b, c, e, f) {
  if (!Q.isFile(a.node.mode)) {
    throw new Q.g(43);
  }
  if (f & 2) {
    return 0;
  }
  R.i.write(a, b, 0, e, c, !1);
  return 0;
}}};
function xb(a, b, c) {
  var e = $a("al " + a);
  ka(a, function(f) {
    assert(f, 'Loading data file "' + a + '" failed (no arrayBuffer).');
    b(new Uint8Array(f));
    e && bb(e);
  }, function() {
    if (c) {
      c();
    } else {
      throw 'Loading data file "' + a + '" failed.';
    }
  });
  e && ab(e);
}
var yb = {}, S = {ya:!1, Xa:() => {
  S.ya = !!process.platform.match(/^win/);
  var a = process.binding("constants");
  a.fs && (a = a.fs);
  S.Ia = {1024:a.O_APPEND, 64:a.O_CREAT, 128:a.O_EXCL, 256:a.O_NOCTTY, 0:a.O_RDONLY, 2:a.O_RDWR, 4096:a.O_SYNC, 512:a.O_TRUNC, 1:a.O_WRONLY, 131072:a.O_NOFOLLOW,};
  assert(0 === S.Ia["0"]);
}, B:a => {
  var b = a.code;
  assert(b in yb, "unexpected node error code: " + b + " (" + a + ")");
  return yb[b];
}, m:a => {
  assert(p);
  return S.createNode(null, "/", S.fa(a.ja.root), 0);
}, createNode:(a, b, c) => {
  if (!Q.v(c) && !Q.isFile(c) && !Q.T(c)) {
    throw new Q.g(28);
  }
  a = Q.createNode(a, b, c);
  a.h = S.h;
  a.i = S.i;
  return a;
}, fa:a => {
  try {
    var b = fs.lstatSync(a);
    S.ya && (b.mode = b.mode | (b.mode & 292) >> 2);
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    throw new Q.g(S.B(c));
  }
  return b.mode;
}, F:a => {
  for (var b = []; a.parent !== a;) {
    b.push(a.name), a = a.parent;
  }
  b.push(a.m.ja.root);
  b.reverse();
  return mb.apply(null, b);
}, Lb:a => {
  a &= -2721793;
  var b = 0, c;
  for (c in S.Ia) {
    a & c && (b |= S.Ia[c], a ^= c);
  }
  if (a) {
    throw new Q.g(28);
  }
  return b;
}, h:{D:a => {
  a = S.F(a);
  try {
    var b = fs.lstatSync(a);
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    throw new Q.g(S.B(c));
  }
  S.ya && !b.P && (b.P = 4096);
  S.ya && !b.blocks && (b.blocks = (b.size + b.P - 1) / b.P | 0);
  return {dev:b.dev, ino:b.ino, mode:b.mode, nlink:b.nlink, uid:b.uid, gid:b.gid, rdev:b.rdev, size:b.size, atime:b.atime, mtime:b.mtime, ctime:b.ctime, P:b.P, blocks:b.blocks};
}, A:(a, b) => {
  var c = S.F(a);
  try {
    void 0 !== b.mode && (fs.chmodSync(c, b.mode), a.mode = b.mode), void 0 !== b.size && fs.truncateSync(c, b.size);
  } catch (e) {
    if (!e.code) {
      throw e;
    }
    throw new Q.g(S.B(e));
  }
}, lookup:(a, b) => {
  var c = P(S.F(a), b);
  c = S.fa(c);
  return S.createNode(a, b, c);
}, I:(a, b, c, e) => {
  a = S.createNode(a, b, c, e);
  b = S.F(a);
  try {
    Q.v(a.mode) ? fs.mkdirSync(b, a.mode) : fs.writeFileSync(b, "", {mode:a.mode});
  } catch (f) {
    if (!f.code) {
      throw f;
    }
    throw new Q.g(S.B(f));
  }
  return a;
}, rename:(a, b, c) => {
  var e = S.F(a);
  b = P(S.F(b), c);
  try {
    fs.renameSync(e, b);
  } catch (f) {
    if (!f.code) {
      throw f;
    }
    throw new Q.g(S.B(f));
  }
  a.name = c;
}, unlink:(a, b) => {
  a = P(S.F(a), b);
  try {
    fs.unlinkSync(a);
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    throw new Q.g(S.B(c));
  }
}, rmdir:(a, b) => {
  a = P(S.F(a), b);
  try {
    fs.rmdirSync(a);
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    throw new Q.g(S.B(c));
  }
}, readdir:a => {
  a = S.F(a);
  try {
    return fs.readdirSync(a);
  } catch (b) {
    if (!b.code) {
      throw b;
    }
    throw new Q.g(S.B(b));
  }
}, symlink:(a, b, c) => {
  a = P(S.F(a), b);
  try {
    fs.symlinkSync(c, a);
  } catch (e) {
    if (!e.code) {
      throw e;
    }
    throw new Q.g(S.B(e));
  }
}, readlink:a => {
  var b = S.F(a);
  try {
    return b = fs.readlinkSync(b), b = oa.relative(oa.resolve(a.m.ja.root), b);
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    if ("UNKNOWN" === c.code) {
      throw new Q.g(28);
    }
    throw new Q.g(S.B(c));
  }
}}, i:{open:a => {
  var b = S.F(a.node);
  try {
    Q.isFile(a.node.mode) && (a.sa = fs.openSync(b, S.Lb(a.flags)));
  } catch (c) {
    if (!c.code) {
      throw c;
    }
    throw new Q.g(S.B(c));
  }
}, close:a => {
  try {
    Q.isFile(a.node.mode) && a.sa && fs.closeSync(a.sa);
  } catch (b) {
    if (!b.code) {
      throw b;
    }
    throw new Q.g(S.B(b));
  }
}, read:(a, b, c, e, f) => {
  if (0 === e) {
    return 0;
  }
  try {
    return fs.readSync(a.sa, Buffer.from(b.buffer), c, e, f);
  } catch (g) {
    throw new Q.g(S.B(g));
  }
}, write:(a, b, c, e, f) => {
  try {
    return fs.writeSync(a.sa, Buffer.from(b.buffer), c, e, f);
  } catch (g) {
    throw new Q.g(S.B(g));
  }
}, C:(a, b, c) => {
  if (1 === c) {
    b += a.position;
  } else if (2 === c && Q.isFile(a.node.mode)) {
    try {
      b += fs.fstatSync(a.sa).size;
    } catch (e) {
      throw new Q.g(S.B(e));
    }
  }
  if (0 > b) {
    throw new Q.g(28);
  }
  return b;
}, ga:(a, b, c, e) => {
  if (0 !== b) {
    throw new Q.g(28);
  }
  if (!Q.isFile(a.node.mode)) {
    throw new Q.g(43);
  }
  b = wb();
  S.i.read(a, E, b, c, e);
  return {N:b, wb:!0};
}, ha:(a, b, c, e, f) => {
  if (!Q.isFile(a.node.mode)) {
    throw new Q.g(43);
  }
  if (f & 2) {
    return 0;
  }
  S.i.write(a, b, 0, e, c, !1);
  return 0;
}}}, U = {Ea:16895, la:33279, Ua:null, m:function(a) {
  function b(g) {
    g = g.split("/");
    for (var l = e, n = 0; n < g.length - 1; n++) {
      var t = g.slice(0, n + 1).join("/");
      f[t] || (f[t] = U.createNode(l, g[n], U.Ea, 0));
      l = f[t];
    }
    return l;
  }
  function c(g) {
    g = g.split("/");
    return g[g.length - 1];
  }
  assert(k);
  U.Ua || (U.Ua = new FileReaderSync());
  var e = U.createNode(null, "/", U.Ea, 0), f = {};
  Array.prototype.forEach.call(a.ja.files || [], function(g) {
    U.createNode(b(g.name), c(g.name), U.la, 0, g, g.lastModifiedDate);
  });
  (a.ja.blobs || []).forEach(function(g) {
    U.createNode(b(g.name), c(g.name), U.la, 0, g.data);
  });
  (a.ja.packages || []).forEach(function(g) {
    g.metadata.files.forEach(function(l) {
      var n = l.filename.substr(1);
      U.createNode(b(n), c(n), U.la, 0, g.blob.slice(l.start, l.end));
    });
  });
  return e;
}, createNode:function(a, b, c, e, f, g) {
  e = Q.createNode(a, b, c);
  e.mode = c;
  e.h = U.h;
  e.i = U.i;
  e.timestamp = (g || new Date()).getTime();
  assert(U.la !== U.Ea);
  c === U.la ? (e.size = f.size, e.j = f) : (e.size = 4096, e.j = {});
  a && (a.j[b] = e);
  return e;
}, h:{D:function(a) {
  return {dev:1, ino:a.id, mode:a.mode, nlink:1, uid:0, gid:0, rdev:void 0, size:a.size, atime:new Date(a.timestamp), mtime:new Date(a.timestamp), ctime:new Date(a.timestamp), P:4096, blocks:Math.ceil(a.size / 4096),};
}, A:function(a, b) {
  void 0 !== b.mode && (a.mode = b.mode);
  void 0 !== b.timestamp && (a.timestamp = b.timestamp);
}, lookup:function() {
  throw new Q.g(44);
}, I:function() {
  throw new Q.g(63);
}, rename:function() {
  throw new Q.g(63);
}, unlink:function() {
  throw new Q.g(63);
}, rmdir:function() {
  throw new Q.g(63);
}, readdir:function(a) {
  var b = [".", ".."], c;
  for (c in a.j) {
    a.j.hasOwnProperty(c) && b.push(c);
  }
  return b;
}, symlink:function() {
  throw new Q.g(63);
}, readlink:function() {
  throw new Q.g(63);
}}, i:{read:function(a, b, c, e, f) {
  if (f >= a.node.size) {
    return 0;
  }
  a = a.node.j.slice(f, f + e);
  e = U.Ua.readAsArrayBuffer(a);
  b.set(new Uint8Array(e), c);
  return a.size;
}, write:function() {
  throw new Q.g(29);
}, C:function(a, b, c) {
  1 === c ? b += a.position : 2 === c && Q.isFile(a.node.mode) && (b += a.node.size);
  if (0 > b) {
    throw new Q.g(28);
  }
  return b;
}}}, zb = {0:"Success", 1:"Arg list too long", 2:"Permission denied", 3:"Address already in use", 4:"Address not available", 5:"Address family not supported by protocol family", 6:"No more processes", 7:"Socket already connected", 8:"Bad file number", 9:"Trying to read unreadable message", 10:"Mount device busy", 11:"Operation canceled", 12:"No children", 13:"Connection aborted", 14:"Connection refused", 15:"Connection reset by peer", 16:"File locking deadlock error", 17:"Destination address required", 
18:"Math arg out of domain of func", 19:"Quota exceeded", 20:"File exists", 21:"Bad address", 22:"File too large", 23:"Host is unreachable", 24:"Identifier removed", 25:"Illegal byte sequence", 26:"Connection already in progress", 27:"Interrupted system call", 28:"Invalid argument", 29:"I/O error", 30:"Socket is already connected", 31:"Is a directory", 32:"Too many symbolic links", 33:"Too many open files", 34:"Too many links", 35:"Message too long", 36:"Multihop attempted", 37:"File or path name too long", 
38:"Network interface is not configured", 39:"Connection reset by network", 40:"Network is unreachable", 41:"Too many open files in system", 42:"No buffer space available", 43:"No such device", 44:"No such file or directory", 45:"Exec format error", 46:"No record locks available", 47:"The link has been severed", 48:"Not enough core", 49:"No message of desired type", 50:"Protocol not available", 51:"No space left on device", 52:"Function not implemented", 53:"Socket is not connected", 54:"Not a directory", 
55:"Directory not empty", 56:"State not recoverable", 57:"Socket operation on non-socket", 59:"Not a typewriter", 60:"No such device or address", 61:"Value too large for defined data type", 62:"Previous owner died", 63:"Not super-user", 64:"Broken pipe", 65:"Protocol error", 66:"Unknown protocol", 67:"Protocol wrong type for socket", 68:"Math result not representable", 69:"Read only file system", 70:"Illegal seek", 71:"No such process", 72:"Stale file handle", 73:"Connection timed out", 74:"Text file busy", 
75:"Cross-device link", 100:"Device not a stream", 101:"Bad font file fmt", 102:"Invalid slot", 103:"Invalid request code", 104:"No anode", 105:"Block device required", 106:"Channel number out of range", 107:"Level 3 halted", 108:"Level 3 reset", 109:"Link number out of range", 110:"Protocol driver not attached", 111:"No CSI structure available", 112:"Level 2 halted", 113:"Invalid exchange", 114:"Invalid request descriptor", 115:"Exchange full", 116:"No data (for no delay io)", 117:"Timer expired", 
118:"Out of streams resources", 119:"Machine is not on the network", 120:"Package not installed", 121:"The object is remote", 122:"Advertise error", 123:"Srmount error", 124:"Communication error on send", 125:"Cross mount point (not really error)", 126:"Given log. name not unique", 127:"f.d. invalid for this operation", 128:"Remote address changed", 129:"Can   access a needed shared lib", 130:"Accessing a corrupted shared lib", 131:".lib section in a.out corrupted", 132:"Attempting to link in too many libs", 
133:"Attempting to exec a shared library", 135:"Streams pipe error", 136:"Too many users", 137:"Socket type not supported", 138:"Not supported", 139:"Protocol family not supported", 140:"Can't send after socket shutdown", 141:"Too many references", 142:"Host is down", 148:"No medium (in tape drive)", 156:"Level 2 not synchronized"}, Q = {root:null, qa:[], fb:{}, streams:[], Wb:1, L:null, eb:"/", va:!1, Na:!0, g:null, Ka:{}, Jb:null, ta:0, o:(a, b = {}) => {
  a = ob(Q.cwd(), a);
  if (!a) {
    return {path:"", node:null};
  }
  b = Object.assign({Ja:!0, Va:0}, b);
  if (8 < b.Va) {
    throw new Q.g(32);
  }
  a = kb(a.split("/").filter(l => !!l), !1);
  for (var c = Q.root, e = "/", f = 0; f < a.length; f++) {
    var g = f === a.length - 1;
    if (g && b.parent) {
      break;
    }
    c = Q.K(c, a[f]);
    e = N(e + "/" + a[f]);
    Q.Z(c) && (!g || g && b.Ja) && (c = c.pa.root);
    if (!g || b.H) {
      for (g = 0; Q.T(c.mode);) {
        if (c = Q.readlink(e), e = ob(lb(e), c), c = Q.o(e, {Va:b.Va + 1}).node, 40 < g++) {
          throw new Q.g(32);
        }
      }
    }
  }
  return {path:e, node:c};
}, S:a => {
  for (var b;;) {
    if (Q.xa(a)) {
      return a = a.m.pb, b ? "/" !== a[a.length - 1] ? a + "/" + b : a + b : a;
    }
    b = b ? a.name + "/" + b : a.name;
    a = a.parent;
  }
}, Ma:(a, b) => {
  for (var c = 0, e = 0; e < b.length; e++) {
    c = (c << 5) - c + b.charCodeAt(e) | 0;
  }
  return (a + c >>> 0) % Q.L.length;
}, nb:a => {
  var b = Q.Ma(a.parent.id, a.name);
  a.aa = Q.L[b];
  Q.L[b] = a;
}, ob:a => {
  var b = Q.Ma(a.parent.id, a.name);
  if (Q.L[b] === a) {
    Q.L[b] = a.aa;
  } else {
    for (b = Q.L[b]; b;) {
      if (b.aa === a) {
        b.aa = a.aa;
        break;
      }
      b = b.aa;
    }
  }
}, K:(a, b) => {
  var c = Q.Tb(a);
  if (c) {
    throw new Q.g(c, a);
  }
  for (c = Q.L[Q.Ma(a.id, b)]; c; c = c.aa) {
    var e = c.name;
    if (c.parent.id === a.id && e === b) {
      return c;
    }
  }
  return Q.lookup(a, b);
}, createNode:(a, b, c, e) => {
  assert("object" == typeof a);
  a = new Q.sb(a, b, c, e);
  Q.nb(a);
  return a;
}, Ha:a => {
  Q.ob(a);
}, xa:a => a === a.parent, Z:a => !!a.pa, isFile:a => 32768 === (a & 61440), v:a => 16384 === (a & 61440), T:a => 40960 === (a & 61440), na:a => 8192 === (a & 61440), Ob:a => 24576 === (a & 61440), isFIFO:a => 4096 === (a & 61440), isSocket:a => 49152 === (a & 49152), Kb:{r:0, "r+":2, w:577, "w+":578, a:1089, "a+":1090}, Vb:a => {
  var b = Q.Kb[a];
  if ("undefined" == typeof b) {
    throw Error("Unknown file open mode: " + a);
  }
  return b;
}, ib:a => {
  var b = ["r", "w", "rw"][a & 3];
  a & 512 && (b += "w");
  return b;
}, U:(a, b) => {
  if (Q.Na) {
    return 0;
  }
  if (!b.includes("r") || a.mode & 292) {
    if (b.includes("w") && !(a.mode & 146) || b.includes("x") && !(a.mode & 73)) {
      return 2;
    }
  } else {
    return 2;
  }
  return 0;
}, Tb:a => {
  var b = Q.U(a, "x");
  return b ? b : a.h.lookup ? 0 : 2;
}, Ra:(a, b) => {
  try {
    return Q.K(a, b), 20;
  } catch (c) {
  }
  return Q.U(a, "wx");
}, za:(a, b, c) => {
  try {
    var e = Q.K(a, b);
  } catch (f) {
    return f.l;
  }
  if (a = Q.U(a, "wx")) {
    return a;
  }
  if (c) {
    if (!Q.v(e.mode)) {
      return 54;
    }
    if (Q.xa(e) || Q.S(e) === Q.cwd()) {
      return 10;
    }
  } else {
    if (Q.v(e.mode)) {
      return 31;
    }
  }
  return 0;
}, Ub:(a, b) => a ? Q.T(a.mode) ? 32 : Q.v(a.mode) && ("r" !== Q.ib(b) || b & 512) ? 31 : Q.U(a, Q.ib(b)) : 44, tb:4096, Xb:(a = 0, b = Q.tb) => {
  for (; a <= b; a++) {
    if (!Q.streams[a]) {
      return a;
    }
  }
  throw new Q.g(33);
}, W:a => Q.streams[a], ea:(a, b, c) => {
  Q.Fa || (Q.Fa = function() {
    this.Ba = {};
  }, Q.Fa.prototype = {object:{get:function() {
    return this.node;
  }, set:function(e) {
    this.node = e;
  }}, flags:{get:function() {
    return this.Ba.flags;
  }, set:function(e) {
    this.Ba.flags = e;
  },}, position:{get tc() {
    return this.Ba.position;
  }, set:function(e) {
    this.Ba.position = e;
  },},});
  a = Object.assign(new Q.Fa(), a);
  b = Q.Xb(b, c);
  a.fd = b;
  return Q.streams[b] = a;
}, Ab:a => {
  Q.streams[a] = null;
}, zb:{open:a => {
  a.i = Q.Mb(a.node.rdev).i;
  a.i.open && a.i.open(a);
}, C:() => {
  throw new Q.g(70);
}}, Qa:a => a >> 8, yc:a => a & 255, $:(a, b) => a << 8 | b, Wa:(a, b) => {
  Q.fb[a] = {i:b};
}, Mb:a => Q.fb[a], kb:a => {
  var b = [];
  for (a = [a]; a.length;) {
    var c = a.pop();
    b.push(c);
    a.push.apply(a, c.qa);
  }
  return b;
}, rb:(a, b) => {
  function c(l) {
    assert(0 < Q.ta);
    Q.ta--;
    return b(l);
  }
  function e(l) {
    if (l) {
      if (!e.Ib) {
        return e.Ib = !0, c(l);
      }
    } else {
      ++g >= f.length && c(null);
    }
  }
  "function" == typeof a && (b = a, a = !1);
  Q.ta++;
  1 < Q.ta && v("warning: " + Q.ta + " FS.syncfs operations in flight at once, probably just doing extra work");
  var f = Q.kb(Q.root.m), g = 0;
  f.forEach(l => {
    if (!l.type.rb) {
      return e(null);
    }
    l.type.rb(l, a, e);
  });
}, m:(a, b, c) => {
  if ("string" == typeof a) {
    throw a;
  }
  var e = "/" === c, f = !c;
  if (e && Q.root) {
    throw new Q.g(10);
  }
  if (!e && !f) {
    var g = Q.o(c, {Ja:!1});
    c = g.path;
    g = g.node;
    if (Q.Z(g)) {
      throw new Q.g(10);
    }
    if (!Q.v(g.mode)) {
      throw new Q.g(54);
    }
  }
  b = {type:a, ja:b, pb:c, qa:[]};
  a = a.m(b);
  a.m = b;
  b.root = a;
  e ? Q.root = a : g && (g.pa = b, g.m && g.m.qa.push(b));
  return a;
}, Hc:a => {
  a = Q.o(a, {Ja:!1});
  if (!Q.Z(a.node)) {
    throw new Q.g(28);
  }
  a = a.node;
  var b = a.pa, c = Q.kb(b);
  Object.keys(Q.L).forEach(e => {
    for (e = Q.L[e]; e;) {
      var f = e.aa;
      c.includes(e.m) && Q.Ha(e);
      e = f;
    }
  });
  a.pa = null;
  b = a.m.qa.indexOf(b);
  assert(-1 !== b);
  a.m.qa.splice(b, 1);
}, lookup:(a, b) => a.h.lookup(a, b), I:(a, b, c) => {
  var e = Q.o(a, {parent:!0}).node;
  a = O(a);
  if (!a || "." === a || ".." === a) {
    throw new Q.g(28);
  }
  var f = Q.Ra(e, a);
  if (f) {
    throw new Q.g(f);
  }
  if (!e.h.I) {
    throw new Q.g(63);
  }
  return e.h.I(e, a, b, c);
}, create:(a, b) => Q.I(a, (void 0 !== b ? b : 438) & 4095 | 32768, 0), mkdir:(a, b) => Q.I(a, (void 0 !== b ? b : 511) & 1023 | 16384, 0), zc:(a, b) => {
  a = a.split("/");
  for (var c = "", e = 0; e < a.length; ++e) {
    if (a[e]) {
      c += "/" + a[e];
      try {
        Q.mkdir(c, b);
      } catch (f) {
        if (20 != f.l) {
          throw f;
        }
      }
    }
  }
}, Aa:(a, b, c) => {
  "undefined" == typeof c && (c = b, b = 438);
  return Q.I(a, b | 8192, c);
}, symlink:(a, b) => {
  if (!ob(a)) {
    throw new Q.g(44);
  }
  var c = Q.o(b, {parent:!0}).node;
  if (!c) {
    throw new Q.g(44);
  }
  b = O(b);
  var e = Q.Ra(c, b);
  if (e) {
    throw new Q.g(e);
  }
  if (!c.h.symlink) {
    throw new Q.g(63);
  }
  return c.h.symlink(c, b, a);
}, rename:(a, b) => {
  var c = lb(a), e = lb(b), f = O(a), g = O(b);
  var l = Q.o(a, {parent:!0});
  var n = l.node;
  l = Q.o(b, {parent:!0});
  l = l.node;
  if (!n || !l) {
    throw new Q.g(44);
  }
  if (n.m !== l.m) {
    throw new Q.g(75);
  }
  var t = Q.K(n, f);
  a = pb(a, e);
  if ("." !== a.charAt(0)) {
    throw new Q.g(28);
  }
  a = pb(b, c);
  if ("." !== a.charAt(0)) {
    throw new Q.g(55);
  }
  try {
    var r = Q.K(l, g);
  } catch (u) {
  }
  if (t !== r) {
    b = Q.v(t.mode);
    if (f = Q.za(n, f, b)) {
      throw new Q.g(f);
    }
    if (f = r ? Q.za(l, g, b) : Q.Ra(l, g)) {
      throw new Q.g(f);
    }
    if (!n.h.rename) {
      throw new Q.g(63);
    }
    if (Q.Z(t) || r && Q.Z(r)) {
      throw new Q.g(10);
    }
    if (l !== n && (f = Q.U(n, "w"))) {
      throw new Q.g(f);
    }
    Q.ob(t);
    try {
      n.h.rename(t, l, g);
    } catch (u) {
      throw u;
    } finally {
      Q.nb(t);
    }
  }
}, rmdir:a => {
  var b = Q.o(a, {parent:!0}).node;
  a = O(a);
  var c = Q.K(b, a), e = Q.za(b, a, !0);
  if (e) {
    throw new Q.g(e);
  }
  if (!b.h.rmdir) {
    throw new Q.g(63);
  }
  if (Q.Z(c)) {
    throw new Q.g(10);
  }
  b.h.rmdir(b, a);
  Q.Ha(c);
}, readdir:a => {
  a = Q.o(a, {H:!0}).node;
  if (!a.h.readdir) {
    throw new Q.g(54);
  }
  return a.h.readdir(a);
}, unlink:a => {
  var b = Q.o(a, {parent:!0}).node;
  if (!b) {
    throw new Q.g(44);
  }
  a = O(a);
  var c = Q.K(b, a), e = Q.za(b, a, !1);
  if (e) {
    throw new Q.g(e);
  }
  if (!b.h.unlink) {
    throw new Q.g(63);
  }
  if (Q.Z(c)) {
    throw new Q.g(10);
  }
  b.h.unlink(b, a);
  Q.Ha(c);
}, readlink:a => {
  a = Q.o(a).node;
  if (!a) {
    throw new Q.g(44);
  }
  if (!a.h.readlink) {
    throw new Q.g(28);
  }
  return ob(Q.S(a.parent), a.h.readlink(a));
}, stat:(a, b) => {
  a = Q.o(a, {H:!b}).node;
  if (!a) {
    throw new Q.g(44);
  }
  if (!a.h.D) {
    throw new Q.g(63);
  }
  return a.h.D(a);
}, lstat:a => Q.stat(a, !0), chmod:(a, b, c) => {
  a = "string" == typeof a ? Q.o(a, {H:!c}).node : a;
  if (!a.h.A) {
    throw new Q.g(63);
  }
  a.h.A(a, {mode:b & 4095 | a.mode & -4096, timestamp:Date.now()});
}, lchmod:(a, b) => {
  Q.chmod(a, b, !0);
}, fchmod:(a, b) => {
  a = Q.W(a);
  if (!a) {
    throw new Q.g(8);
  }
  Q.chmod(a.node, b);
}, chown:(a, b, c, e) => {
  a = "string" == typeof a ? Q.o(a, {H:!e}).node : a;
  if (!a.h.A) {
    throw new Q.g(63);
  }
  a.h.A(a, {timestamp:Date.now()});
}, lchown:(a, b, c) => {
  Q.chown(a, b, c, !0);
}, fchown:(a, b, c) => {
  a = Q.W(a);
  if (!a) {
    throw new Q.g(8);
  }
  Q.chown(a.node, b, c);
}, truncate:(a, b) => {
  if (0 > b) {
    throw new Q.g(28);
  }
  a = "string" == typeof a ? Q.o(a, {H:!0}).node : a;
  if (!a.h.A) {
    throw new Q.g(63);
  }
  if (Q.v(a.mode)) {
    throw new Q.g(31);
  }
  if (!Q.isFile(a.mode)) {
    throw new Q.g(28);
  }
  var c = Q.U(a, "w");
  if (c) {
    throw new Q.g(c);
  }
  a.h.A(a, {size:b, timestamp:Date.now()});
}, rc:(a, b) => {
  a = Q.W(a);
  if (!a) {
    throw new Q.g(8);
  }
  if (0 === (a.flags & 2097155)) {
    throw new Q.g(28);
  }
  Q.truncate(a.node, b);
}, Ic:(a, b, c) => {
  a = Q.o(a, {H:!0}).node;
  a.h.A(a, {timestamp:Math.max(b, c)});
}, open:(a, b, c) => {
  if ("" === a) {
    throw new Q.g(44);
  }
  b = "string" == typeof b ? Q.Vb(b) : b;
  c = b & 64 ? ("undefined" == typeof c ? 438 : c) & 4095 | 32768 : 0;
  if ("object" == typeof a) {
    var e = a;
  } else {
    a = N(a);
    try {
      e = Q.o(a, {H:!(b & 131072)}).node;
    } catch (g) {
    }
  }
  var f = !1;
  if (b & 64) {
    if (e) {
      if (b & 128) {
        throw new Q.g(20);
      }
    } else {
      e = Q.I(a, c, 0), f = !0;
    }
  }
  if (!e) {
    throw new Q.g(44);
  }
  Q.na(e.mode) && (b &= -513);
  if (b & 65536 && !Q.v(e.mode)) {
    throw new Q.g(54);
  }
  if (!f && (c = Q.Ub(e, b))) {
    throw new Q.g(c);
  }
  b & 512 && !f && Q.truncate(e, 0);
  b &= -131713;
  e = Q.ea({node:e, path:Q.S(e), flags:b, seekable:!0, position:0, i:e.i, jc:[], error:!1});
  e.i.open && e.i.open(e);
  !d.logReadFiles || b & 1 || (Q.Ta || (Q.Ta = {}), a in Q.Ta || (Q.Ta[a] = 1));
  return e;
}, close:a => {
  if (Q.oa(a)) {
    throw new Q.g(8);
  }
  a.X && (a.X = null);
  try {
    a.i.close && a.i.close(a);
  } catch (b) {
    throw b;
  } finally {
    Q.Ab(a.fd);
  }
  a.fd = null;
}, oa:a => null === a.fd, C:(a, b, c) => {
  if (Q.oa(a)) {
    throw new Q.g(8);
  }
  if (!a.seekable || !a.i.C) {
    throw new Q.g(70);
  }
  if (0 != c && 1 != c && 2 != c) {
    throw new Q.g(28);
  }
  a.position = a.i.C(a, b, c);
  a.jc = [];
  return a.position;
}, read:(a, b, c, e, f) => {
  if (0 > e || 0 > f) {
    throw new Q.g(28);
  }
  if (Q.oa(a)) {
    throw new Q.g(8);
  }
  if (1 === (a.flags & 2097155)) {
    throw new Q.g(8);
  }
  if (Q.v(a.node.mode)) {
    throw new Q.g(31);
  }
  if (!a.i.read) {
    throw new Q.g(28);
  }
  var g = "undefined" != typeof f;
  if (!g) {
    f = a.position;
  } else if (!a.seekable) {
    throw new Q.g(70);
  }
  b = a.i.read(a, b, c, e, f);
  g || (a.position += b);
  return b;
}, write:(a, b, c, e, f, g) => {
  if (0 > e || 0 > f) {
    throw new Q.g(28);
  }
  if (Q.oa(a)) {
    throw new Q.g(8);
  }
  if (0 === (a.flags & 2097155)) {
    throw new Q.g(8);
  }
  if (Q.v(a.node.mode)) {
    throw new Q.g(31);
  }
  if (!a.i.write) {
    throw new Q.g(28);
  }
  a.seekable && a.flags & 1024 && Q.C(a, 0, 2);
  var l = "undefined" != typeof f;
  if (!l) {
    f = a.position;
  } else if (!a.seekable) {
    throw new Q.g(70);
  }
  b = a.i.write(a, b, c, e, f, g);
  l || (a.position += b);
  return b;
}, ma:(a, b, c) => {
  if (Q.oa(a)) {
    throw new Q.g(8);
  }
  if (0 > b || 0 >= c) {
    throw new Q.g(28);
  }
  if (0 === (a.flags & 2097155)) {
    throw new Q.g(8);
  }
  if (!Q.isFile(a.node.mode) && !Q.v(a.node.mode)) {
    throw new Q.g(43);
  }
  if (!a.i.ma) {
    throw new Q.g(138);
  }
  a.i.ma(a, b, c);
}, ga:(a, b, c, e, f, g) => {
  if (0 !== (f & 2) && 0 === (g & 2) && 2 !== (a.flags & 2097155)) {
    throw new Q.g(2);
  }
  if (1 === (a.flags & 2097155)) {
    throw new Q.g(2);
  }
  if (!a.i.ga) {
    throw new Q.g(43);
  }
  return a.i.ga(a, b, c, e, f, g);
}, ha:(a, b, c, e, f) => a && a.i.ha ? a.i.ha(a, b, c, e, f) : 0, Bc:() => 0, wa:(a, b, c) => {
  if (!a.i.wa) {
    throw new Q.g(59);
  }
  return a.i.wa(a, b, c);
}, readFile:(a, b = {}) => {
  b.flags = b.flags || 0;
  b.encoding = b.encoding || "binary";
  if ("utf8" !== b.encoding && "binary" !== b.encoding) {
    throw Error('Invalid encoding type "' + b.encoding + '"');
  }
  var c, e = Q.open(a, b.flags);
  a = Q.stat(a).size;
  var f = new Uint8Array(a);
  Q.read(e, f, 0, a, 0);
  "utf8" === b.encoding ? c = za(f, 0) : "binary" === b.encoding && (c = f);
  Q.close(e);
  return c;
}, writeFile:(a, b, c = {}) => {
  c.flags = c.flags || 577;
  a = Q.open(a, c.flags, c.mode);
  if ("string" == typeof b) {
    var e = new Uint8Array(Ca(b) + 1);
    b = Ba(b, e, 0, e.length);
    Q.write(a, e, 0, b, void 0, c.yb);
  } else if (ArrayBuffer.isView(b)) {
    Q.write(a, b, 0, b.byteLength, void 0, c.yb);
  } else {
    throw Error("Unsupported data type");
  }
  Q.close(a);
}, cwd:() => Q.eb, chdir:a => {
  a = Q.o(a, {H:!0});
  if (null === a.node) {
    throw new Q.g(44);
  }
  if (!Q.v(a.node.mode)) {
    throw new Q.g(54);
  }
  var b = Q.U(a.node, "x");
  if (b) {
    throw new Q.g(b);
  }
  Q.eb = a.path;
}, Cb:() => {
  Q.mkdir("/tmp");
  Q.mkdir("/home");
  Q.mkdir("/home/web_user");
}, Bb:() => {
  Q.mkdir("/dev");
  Q.Wa(Q.$(1, 3), {read:() => 0, write:(b, c, e, f) => f,});
  Q.Aa("/dev/null", Q.$(1, 3));
  rb(Q.$(5, 0), ub);
  rb(Q.$(6, 0), vb);
  Q.Aa("/dev/tty", Q.$(5, 0));
  Q.Aa("/dev/tty1", Q.$(6, 0));
  var a = nb();
  Q.R("/dev", "random", a);
  Q.R("/dev", "urandom", a);
  Q.mkdir("/dev/shm");
  Q.mkdir("/dev/shm/tmp");
}, Gb:() => {
  Q.mkdir("/proc");
  var a = Q.mkdir("/proc/self");
  Q.mkdir("/proc/self/fd");
  Q.m({m:() => {
    var b = Q.createNode(a, "fd", 16895, 73);
    b.h = {lookup:(c, e) => {
      var f = Q.W(+e);
      if (!f) {
        throw new Q.g(8);
      }
      c = {parent:null, m:{pb:"fake"}, h:{readlink:() => f.path},};
      return c.parent = c;
    }};
    return b;
  }}, {}, "/proc/self/fd");
}, Hb:() => {
  d.stdin ? Q.R("/dev", "stdin", d.stdin) : Q.symlink("/dev/tty", "/dev/stdin");
  d.stdout ? Q.R("/dev", "stdout", null, d.stdout) : Q.symlink("/dev/tty", "/dev/stdout");
  d.stderr ? Q.R("/dev", "stderr", null, d.stderr) : Q.symlink("/dev/tty1", "/dev/stderr");
  var a = Q.open("/dev/stdin", 0), b = Q.open("/dev/stdout", 1), c = Q.open("/dev/stderr", 1);
  assert(0 === a.fd, "invalid handle for stdin (" + a.fd + ")");
  assert(1 === b.fd, "invalid handle for stdout (" + b.fd + ")");
  assert(2 === c.fd, "invalid handle for stderr (" + c.fd + ")");
}, gb:() => {
  Q.g || (Q.g = function(a, b) {
    this.node = b;
    this.dc = function(c) {
      this.l = c;
      for (var e in yb) {
        if (yb[e] === c) {
          this.code = e;
          break;
        }
      }
    };
    this.dc(a);
    this.message = zb[a];
    this.stack && (Object.defineProperty(this, "stack", {value:Error().stack, writable:!0}), this.stack = hb(this.stack));
  }, Q.g.prototype = Error(), Q.g.prototype.constructor = Q.g, [44].forEach(a => {
    Q.Ka[a] = new Q.g(a);
    Q.Ka[a].stack = "<generic error, no stack>";
  }));
}, Xa:() => {
  Q.gb();
  Q.L = Array(4096);
  Q.m(R, {}, "/");
  Q.Cb();
  Q.Bb();
  Q.Gb();
  Q.Jb = {MEMFS:R, NODEFS:S, WORKERFS:U,};
}, Y:(a, b, c) => {
  assert(!Q.Y.va, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
  Q.Y.va = !0;
  Q.gb();
  d.stdin = a || d.stdin;
  d.stdout = b || d.stdout;
  d.stderr = c || d.stderr;
  Q.Hb();
}, Dc:() => {
  Q.Y.va = !1;
  Ab();
  for (var a = 0; a < Q.streams.length; a++) {
    var b = Q.streams[a];
    b && Q.close(b);
  }
}, fa:(a, b) => {
  var c = 0;
  a && (c |= 365);
  b && (c |= 146);
  return c;
}, qc:(a, b) => {
  a = Q.ua(a, b);
  return a.exists ? a.object : null;
}, ua:(a, b) => {
  try {
    var c = Q.o(a, {H:!b});
    a = c.path;
  } catch (f) {
  }
  var e = {xa:!1, exists:!1, error:0, name:null, path:null, object:null, Zb:!1, ac:null, $b:null};
  try {
    c = Q.o(a, {parent:!0}), e.Zb = !0, e.ac = c.path, e.$b = c.node, e.name = O(a), c = Q.o(a, {H:!b}), e.exists = !0, e.path = c.path, e.object = c.node, e.name = c.node.name, e.xa = "/" === c.path;
  } catch (f) {
    e.error = f.l;
  }
  return e;
}, oc:(a, b) => {
  a = "string" == typeof a ? a : Q.S(a);
  for (b = b.split("/").reverse(); b.length;) {
    var c = b.pop();
    if (c) {
      var e = N(a + "/" + c);
      try {
        Q.mkdir(e);
      } catch (f) {
      }
      a = e;
    }
  }
  return e;
}, Db:(a, b, c, e, f) => {
  a = P("string" == typeof a ? a : Q.S(a), b);
  e = Q.fa(e, f);
  return Q.create(a, e);
}, cb:(a, b, c, e, f, g) => {
  var l = b;
  a && (a = "string" == typeof a ? a : Q.S(a), l = b ? N(a + "/" + b) : a);
  a = Q.fa(e, f);
  l = Q.create(l, a);
  if (c) {
    if ("string" == typeof c) {
      b = Array(c.length);
      e = 0;
      for (f = c.length; e < f; ++e) {
        b[e] = c.charCodeAt(e);
      }
      c = b;
    }
    Q.chmod(l, a | 146);
    b = Q.open(l, 577);
    Q.write(b, c, 0, c.length, 0, g);
    Q.close(b);
    Q.chmod(l, a);
  }
  return l;
}, R:(a, b, c, e) => {
  a = P("string" == typeof a ? a : Q.S(a), b);
  b = Q.fa(!!c, !!e);
  Q.R.Qa || (Q.R.Qa = 64);
  var f = Q.$(Q.R.Qa++, 0);
  Q.Wa(f, {open:g => {
    g.seekable = !1;
  }, close:() => {
    e && e.buffer && e.buffer.length && e(10);
  }, read:(g, l, n, t) => {
    for (var r = 0, u = 0; u < t; u++) {
      try {
        var B = c();
      } catch (F) {
        throw new Q.g(29);
      }
      if (void 0 === B && 0 === r) {
        throw new Q.g(6);
      }
      if (null === B || void 0 === B) {
        break;
      }
      r++;
      l[n + u] = B;
    }
    r && (g.node.timestamp = Date.now());
    return r;
  }, write:(g, l, n, t) => {
    for (var r = 0; r < t; r++) {
      try {
        e(l[n + r]);
      } catch (u) {
        throw new Q.g(29);
      }
    }
    t && (g.node.timestamp = Date.now());
    return r;
  }});
  return Q.Aa(a, b, f);
}, jb:a => {
  if (a.Oa || a.Pb || a.link || a.j) {
    return !0;
  }
  if ("undefined" != typeof XMLHttpRequest) {
    throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
  }
  if (ja) {
    try {
      a.j = tb(ja(a.url), !0), a.s = a.j.length;
    } catch (b) {
      throw new Q.g(29);
    }
  } else {
    throw Error("Cannot load without read() or XMLHttpRequest.");
  }
}, Eb:(a, b, c, e, f) => {
  function g() {
    this.Pa = !1;
    this.V = [];
  }
  g.prototype.get = function(r) {
    if (!(r > this.length - 1 || 0 > r)) {
      var u = r % this.chunkSize;
      return this.mb(r / this.chunkSize | 0)[u];
    }
  };
  g.prototype.La = function(r) {
    this.mb = r;
  };
  g.prototype.ab = function() {
    var r = new XMLHttpRequest();
    r.open("HEAD", c, !1);
    r.send(null);
    if (!(200 <= r.status && 300 > r.status || 304 === r.status)) {
      throw Error("Couldn't load " + c + ". Status: " + r.status);
    }
    var u = Number(r.getResponseHeader("Content-length")), B, F = (B = r.getResponseHeader("Accept-Ranges")) && "bytes" === B;
    r = (B = r.getResponseHeader("Content-Encoding")) && "gzip" === B;
    var m = 1048576;
    F || (m = u);
    var x = this;
    x.La(z => {
      var K = z * m, T = (z + 1) * m - 1;
      T = Math.min(T, u - 1);
      if ("undefined" == typeof x.V[z]) {
        var Xb = x.V;
        if (K > T) {
          throw Error("invalid range (" + K + ", " + T + ") or no bytes requested!");
        }
        if (T > u - 1) {
          throw Error("only " + u + " bytes available! programmer error!");
        }
        var L = new XMLHttpRequest();
        L.open("GET", c, !1);
        u !== m && L.setRequestHeader("Range", "bytes=" + K + "-" + T);
        L.responseType = "arraybuffer";
        L.overrideMimeType && L.overrideMimeType("text/plain; charset=x-user-defined");
        L.send(null);
        if (!(200 <= L.status && 300 > L.status || 304 === L.status)) {
          throw Error("Couldn't load " + c + ". Status: " + L.status);
        }
        K = void 0 !== L.response ? new Uint8Array(L.response || []) : tb(L.responseText || "", !0);
        Xb[z] = K;
      }
      if ("undefined" == typeof x.V[z]) {
        throw Error("doXHR failed!");
      }
      return x.V[z];
    });
    if (r || !u) {
      m = u = 1, m = u = this.mb(0).length, w("LazyFiles on gzip forces download of the whole file when length is accessed");
    }
    this.vb = u;
    this.ub = m;
    this.Pa = !0;
  };
  if ("undefined" != typeof XMLHttpRequest) {
    if (!k) {
      throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
    }
    var l = new g();
    Object.defineProperties(l, {length:{get:function() {
      this.Pa || this.ab();
      return this.vb;
    }}, chunkSize:{get:function() {
      this.Pa || this.ab();
      return this.ub;
    }}});
    l = {Oa:!1, j:l};
  } else {
    l = {Oa:!1, url:c};
  }
  var n = Q.Db(a, b, l, e, f);
  l.j ? n.j = l.j : l.url && (n.j = null, n.url = l.url);
  Object.defineProperties(n, {s:{get:function() {
    return this.j.length;
  }}});
  var t = {};
  Object.keys(n.i).forEach(r => {
    var u = n.i[r];
    t[r] = function() {
      Q.jb(n);
      return u.apply(null, arguments);
    };
  });
  t.read = (r, u, B, F, m) => {
    Q.jb(n);
    r = r.node.j;
    if (m >= r.length) {
      return 0;
    }
    F = Math.min(r.length - m, F);
    assert(0 <= F);
    if (r.slice) {
      for (var x = 0; x < F; x++) {
        u[B + x] = r[m + x];
      }
    } else {
      for (x = 0; x < F; x++) {
        u[B + x] = r.get(m + x);
      }
    }
    return F;
  };
  n.i = t;
  return n;
}, pc:(a, b, c, e, f, g, l, n, t, r) => {
  function u(m) {
    function x(z) {
      r && r();
      n || Q.cb(a, b, z, e, f, t);
      g && g();
      bb(F);
    }
    Bb.vc(m, B, x, () => {
      l && l();
      bb(F);
    }) || x(m);
  }
  var B = b ? ob(N(a + "/" + b)) : a, F = $a("cp " + B);
  ab(F);
  "string" == typeof c ? xb(c, m => u(m), l) : u(c);
}, indexedDB:() => window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB, Za:() => "EM_FS_" + window.location.pathname, $a:20, ka:"FILE_DATA", Ec:(a, b, c) => {
  b = b || (() => {
  });
  c = c || (() => {
  });
  var e = Q.indexedDB();
  try {
    var f = e.open(Q.Za(), Q.$a);
  } catch (g) {
    return c(g);
  }
  f.onupgradeneeded = () => {
    w("creating db");
    f.result.createObjectStore(Q.ka);
  };
  f.onsuccess = () => {
    var g = f.result.transaction([Q.ka], "readwrite"), l = g.objectStore(Q.ka), n = 0, t = 0, r = a.length;
    a.forEach(u => {
      u = l.put(Q.ua(u).object.j, u);
      u.onsuccess = () => {
        n++;
        n + t == r && (0 == t ? b() : c());
      };
      u.onerror = () => {
        t++;
        n + t == r && (0 == t ? b() : c());
      };
    });
    g.onerror = c;
  };
  f.onerror = c;
}, xc:(a, b, c) => {
  b = b || (() => {
  });
  c = c || (() => {
  });
  var e = Q.indexedDB();
  try {
    var f = e.open(Q.Za(), Q.$a);
  } catch (g) {
    return c(g);
  }
  f.onupgradeneeded = c;
  f.onsuccess = () => {
    var g = f.result;
    try {
      var l = g.transaction([Q.ka], "readonly");
    } catch (B) {
      c(B);
      return;
    }
    var n = l.objectStore(Q.ka), t = 0, r = 0, u = a.length;
    a.forEach(B => {
      var F = n.get(B);
      F.onsuccess = () => {
        Q.ua(B).exists && Q.unlink(B);
        Q.cb(lb(B), O(B), F.result, !0, !0, !0);
        t++;
        t + r == u && (0 == r ? b() : c());
      };
      F.onerror = () => {
        r++;
        t + r == u && (0 == r ? b() : c());
      };
    });
    l.onerror = c;
  };
  f.onerror = c;
}, lc:() => {
  h("FS.absolutePath has been removed; use PATH_FS.resolve instead");
}, mc:() => {
  h("FS.createFolder has been removed; use FS.mkdir instead");
}, nc:() => {
  h("FS.createLink has been removed; use FS.symlink instead");
}, wc:() => {
  h("FS.joinPath has been removed; use PATH.join instead");
}, Ac:() => {
  h("FS.mmapAlloc has been replaced by the top level function mmapAlloc");
}, Fc:() => {
  h("FS.standardizePath has been removed; use PATH.normalize instead");
}};
function Cb(a, b, c) {
  if ("/" === b.charAt(0)) {
    return b;
  }
  if (-100 === a) {
    a = Q.cwd();
  } else {
    a = Q.W(a);
    if (!a) {
      throw new Q.g(8);
    }
    a = a.path;
  }
  if (0 == b.length) {
    if (!c) {
      throw new Q.g(44);
    }
    return a;
  }
  return N(a + "/" + b);
}
function Db(a, b, c) {
  try {
    var e = a(b);
  } catch (f) {
    if (f && f.node && N(b) !== N(Q.S(f.node))) {
      return -54;
    }
    throw f;
  }
  G[c >> 2] = e.dev;
  G[c + 4 >> 2] = 0;
  G[c + 8 >> 2] = e.ino;
  G[c + 12 >> 2] = e.mode;
  G[c + 16 >> 2] = e.nlink;
  G[c + 20 >> 2] = e.uid;
  G[c + 24 >> 2] = e.gid;
  G[c + 28 >> 2] = e.rdev;
  G[c + 32 >> 2] = 0;
  Ka[c + 40 >> 3] = BigInt(e.size);
  G[c + 48 >> 2] = 4096;
  G[c + 52 >> 2] = e.blocks;
  G[c + 56 >> 2] = e.atime.getTime() / 1000 | 0;
  G[c + 60 >> 2] = 0;
  G[c + 64 >> 2] = e.mtime.getTime() / 1000 | 0;
  G[c + 68 >> 2] = 0;
  G[c + 72 >> 2] = e.ctime.getTime() / 1000 | 0;
  G[c + 76 >> 2] = 0;
  Ka[c + 80 >> 3] = BigInt(e.ino);
  return 0;
}
var Eb = void 0;
function Fb() {
  assert(void 0 != Eb);
  Eb += 4;
  return G[Eb - 4 >> 2];
}
function V(a) {
  a = Q.W(a);
  if (!a) {
    throw new Q.g(8);
  }
  return a;
}
var W = {G:8192, m:function() {
  return Q.createNode(null, "/", 16895, 0);
}, Fb:function() {
  var a = {u:[], qb:2,};
  a.u.push({buffer:new Uint8Array(W.G), offset:0, J:0});
  var b = W.ra(), c = W.ra(), e = Q.createNode(W.root, b, 4096, 0), f = Q.createNode(W.root, c, 4096, 0);
  e.pipe = a;
  f.pipe = a;
  a = Q.ea({path:b, node:e, flags:0, seekable:!1, i:W.i});
  e.stream = a;
  c = Q.ea({path:c, node:f, flags:1, seekable:!1, i:W.i});
  f.stream = c;
  return {bc:a.fd, kc:c.fd};
}, i:{Cc:function(a) {
  var b = a.node.pipe;
  if (1 === (a.flags & 2097155)) {
    return 260;
  }
  if (0 < b.u.length) {
    for (a = 0; a < b.u.length; a++) {
      var c = b.u[a];
      if (0 < c.offset - c.J) {
        return 65;
      }
    }
  }
  return 0;
}, wa:function() {
  return 28;
}, fsync:function() {
  return 28;
}, read:function(a, b, c, e) {
  a = a.node.pipe;
  for (var f = 0, g = 0; g < a.u.length; g++) {
    var l = a.u[g];
    f += l.offset - l.J;
  }
  assert(b instanceof ArrayBuffer || ArrayBuffer.isView(b));
  b = b.subarray(c, c + e);
  if (0 >= e) {
    return 0;
  }
  if (0 == f) {
    throw new Q.g(6);
  }
  c = e = Math.min(f, e);
  for (g = f = 0; g < a.u.length; g++) {
    l = a.u[g];
    var n = l.offset - l.J;
    if (e <= n) {
      var t = l.buffer.subarray(l.J, l.offset);
      e < n ? (t = t.subarray(0, e), l.J += e) : f++;
      b.set(t);
      break;
    } else {
      t = l.buffer.subarray(l.J, l.offset), b.set(t), b = b.subarray(t.byteLength), e -= t.byteLength, f++;
    }
  }
  f && f == a.u.length && (f--, a.u[f].offset = 0, a.u[f].J = 0);
  a.u.splice(0, f);
  return c;
}, write:function(a, b, c, e) {
  a = a.node.pipe;
  assert(b instanceof ArrayBuffer || ArrayBuffer.isView(b));
  b = b.subarray(c, c + e);
  c = b.byteLength;
  if (0 >= c) {
    return 0;
  }
  0 == a.u.length ? (e = {buffer:new Uint8Array(W.G), offset:0, J:0}, a.u.push(e)) : e = a.u[a.u.length - 1];
  assert(e.offset <= W.G);
  var f = W.G - e.offset;
  if (f >= c) {
    return e.buffer.set(b, e.offset), e.offset += c, c;
  }
  0 < f && (e.buffer.set(b.subarray(0, f), e.offset), e.offset += f, b = b.subarray(f, b.byteLength));
  e = b.byteLength / W.G | 0;
  f = b.byteLength % W.G;
  for (var g = 0; g < e; g++) {
    var l = {buffer:new Uint8Array(W.G), offset:W.G, J:0};
    a.u.push(l);
    l.buffer.set(b.subarray(0, W.G));
    b = b.subarray(W.G, b.byteLength);
  }
  0 < f && (l = {buffer:new Uint8Array(W.G), offset:b.byteLength, J:0}, a.u.push(l), l.buffer.set(b));
  return c;
}, close:function(a) {
  a = a.node.pipe;
  a.qb--;
  0 === a.qb && (a.u = null);
}}, ra:function() {
  W.ra.current || (W.ra.current = 0);
  return "pipe[" + W.ra.current++ + "]";
}};
function Gb(a, b, c) {
  function e(t) {
    return (t = t.toTimeString().match(/\(([A-Za-z ]+)\)$/)) ? t[1] : "GMT";
  }
  var f = (new Date()).getFullYear(), g = new Date(f, 0, 1), l = new Date(f, 6, 1);
  f = g.getTimezoneOffset();
  var n = l.getTimezoneOffset();
  G[a >> 2] = 60 * Math.max(f, n);
  G[b >> 2] = Number(f != n);
  a = e(g);
  b = e(l);
  a = Da(a);
  b = Da(b);
  n < f ? (G[c >> 2] = a, G[c + 4 >> 2] = b) : (G[c >> 2] = b, G[c + 4 >> 2] = a);
}
function Hb(a, b, c) {
  Hb.xb || (Hb.xb = !0, Gb(a, b, c));
}
var Ib;
Ib = p ? () => {
  var a = process.hrtime();
  return 1e3 * a[0] + a[1] / 1e6;
} : () => performance.now();
var Jb = {};
function Kb() {
  if (!Lb) {
    var a = {USER:"web_user", LOGNAME:"web_user", PATH:"/", PWD:"/", HOME:"/home/web_user", LANG:("object" == typeof navigator && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", _:ea || "./this.program"}, b;
    for (b in Jb) {
      void 0 === Jb[b] ? delete a[b] : a[b] = Jb[b];
    }
    var c = [];
    for (b in a) {
      c.push(b + "=" + a[b]);
    }
    Lb = c;
  }
  return Lb;
}
var Lb;
function Mb(a, b, c, e) {
  for (var f = 0, g = 0; g < c; g++) {
    var l = H[b >> 2], n = H[b + 4 >> 2];
    b += 8;
    l = Q.read(a, E, l, n, e);
    if (0 > l) {
      return -1;
    }
    f += l;
    if (l < n) {
      break;
    }
  }
  return f;
}
function Nb(a, b, c, e) {
  for (var f = 0, g = 0; g < c; g++) {
    var l = H[b >> 2], n = H[b + 4 >> 2];
    b += 8;
    l = Q.write(a, E, l, n, e);
    if (0 > l) {
      return -1;
    }
    f += l;
  }
  return f;
}
function Ob(a) {
  return 0 === a % 4 && (0 !== a % 100 || 0 === a % 400);
}
var Pb = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], Qb = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function Rb(a, b, c, e) {
  a || (a = this);
  this.parent = a;
  this.m = a.m;
  this.pa = null;
  this.id = Q.Wb++;
  this.name = b;
  this.mode = c;
  this.h = {};
  this.i = {};
  this.rdev = e;
}
Object.defineProperties(Rb.prototype, {read:{get:function() {
  return 365 === (this.mode & 365);
}, set:function(a) {
  a ? this.mode |= 365 : this.mode &= -366;
}}, write:{get:function() {
  return 146 === (this.mode & 146);
}, set:function(a) {
  a ? this.mode |= 146 : this.mode &= -147;
}}, Pb:{get:function() {
  return Q.v(this.mode);
}}, Oa:{get:function() {
  return Q.na(this.mode);
}}});
Q.sb = Rb;
Q.Xa();
var Bb;
p && (pa(), S.Xa());
yb = {EPERM:63, ENOENT:44, ESRCH:71, EINTR:27, EIO:29, ENXIO:60, E2BIG:1, ENOEXEC:45, EBADF:8, ECHILD:12, EAGAIN:6, EWOULDBLOCK:6, ENOMEM:48, EACCES:2, EFAULT:21, ENOTBLK:105, EBUSY:10, EEXIST:20, EXDEV:75, ENODEV:43, ENOTDIR:54, EISDIR:31, EINVAL:28, ENFILE:41, EMFILE:33, ENOTTY:59, ETXTBSY:74, EFBIG:22, ENOSPC:51, ESPIPE:70, EROFS:69, EMLINK:34, EPIPE:64, EDOM:18, ERANGE:68, ENOMSG:49, EIDRM:24, ECHRNG:106, EL2NSYNC:156, EL3HLT:107, EL3RST:108, ELNRNG:109, EUNATCH:110, ENOCSI:111, EL2HLT:112, EDEADLK:16, 
ENOLCK:46, EBADE:113, EBADR:114, EXFULL:115, ENOANO:104, EBADRQC:103, EBADSLT:102, EDEADLOCK:16, EBFONT:101, ENOSTR:100, ENODATA:116, ETIME:117, ENOSR:118, ENONET:119, ENOPKG:120, EREMOTE:121, ENOLINK:47, EADV:122, ESRMNT:123, ECOMM:124, EPROTO:65, EMULTIHOP:36, EDOTDOT:125, EBADMSG:9, ENOTUNIQ:126, EBADFD:127, EREMCHG:128, ELIBACC:129, ELIBBAD:130, ELIBSCN:131, ELIBMAX:132, ELIBEXEC:133, ENOSYS:52, ENOTEMPTY:55, ENAMETOOLONG:37, ELOOP:32, EOPNOTSUPP:138, EPFNOSUPPORT:139, ECONNRESET:15, ENOBUFS:42, 
EAFNOSUPPORT:5, EPROTOTYPE:67, ENOTSOCK:57, ENOPROTOOPT:50, ESHUTDOWN:140, ECONNREFUSED:14, EADDRINUSE:3, ECONNABORTED:13, ENETUNREACH:40, ENETDOWN:38, ETIMEDOUT:73, EHOSTDOWN:142, EHOSTUNREACH:23, EINPROGRESS:26, EALREADY:7, EDESTADDRREQ:17, EMSGSIZE:35, EPROTONOSUPPORT:66, ESOCKTNOSUPPORT:137, EADDRNOTAVAIL:4, ENETRESET:39, EISCONN:30, ENOTCONN:53, ETOOMANYREFS:141, EUSERS:136, EDQUOT:19, ESTALE:72, ENOTSUP:138, ENOMEDIUM:148, EILSEQ:25, EOVERFLOW:61, ECANCELED:11, ENOTRECOVERABLE:56, EOWNERDEAD:62, 
ESTRPIPE:135,};
function tb(a, b) {
  var c = Array(Ca(a) + 1);
  a = Ba(a, c, 0, c.length);
  b && (c.length = a);
  return c;
}
var hc = {__assert_fail:function(a, b, c, e) {
  h("Assertion failed: " + D(a) + ", at: " + [b ? D(b) : "unknown filename", c, e ? D(e) : "unknown function"]);
}, __cxa_find_matching_catch_2:function() {
  var a = ib;
  if (!a) {
    return ua = 0;
  }
  var b = new jb(a);
  b.V(a);
  var c = b.La();
  if (!c) {
    return ua = 0, a;
  }
  for (var e = Array.prototype.slice.call(arguments), f = 0; f < e.length; f++) {
    var g = e[f];
    if (0 === g || g === c) {
      break;
    }
    if (Sb(g, c, b.N + 16)) {
      return ua = g, a;
    }
  }
  ua = c;
  return a;
}, __resumeException:function(a) {
  ib || (ib = a);
  throw a;
}, __syscall_dup:function(a) {
  try {
    var b = V(a);
    return Q.ea(b, 0).fd;
  } catch (c) {
    if ("undefined" == typeof Q || !(c instanceof Q.g)) {
      throw c;
    }
    return -c.l;
  }
}, __syscall_dup3:function(a, b, c) {
  try {
    var e = V(a);
    assert(!c);
    if (e.fd === b) {
      return -28;
    }
    var f = Q.W(b);
    f && Q.close(f);
    return Q.ea(e, b, b + 1).fd;
  } catch (g) {
    if ("undefined" == typeof Q || !(g instanceof Q.g)) {
      throw g;
    }
    return -g.l;
  }
}, __syscall_faccessat:function(a, b, c, e) {
  try {
    b = D(b);
    assert(0 === e);
    b = Cb(a, b);
    if (c & -8) {
      return -28;
    }
    var f = Q.o(b, {H:!0}).node;
    if (!f) {
      return -44;
    }
    a = "";
    c & 4 && (a += "r");
    c & 2 && (a += "w");
    c & 1 && (a += "x");
    return a && Q.U(f, a) ? -2 : 0;
  } catch (g) {
    if ("undefined" == typeof Q || !(g instanceof Q.g)) {
      throw g;
    }
    return -g.l;
  }
}, __syscall_fcntl64:function(a, b, c) {
  Eb = c;
  try {
    var e = V(a);
    switch(b) {
      case 0:
        var f = Fb();
        return 0 > f ? -28 : Q.ea(e, f).fd;
      case 1:
      case 2:
        return 0;
      case 3:
        return e.flags;
      case 4:
        return f = Fb(), e.flags |= f, 0;
      case 5:
        return f = Fb(), Ja[f + 0 >> 1] = 2, 0;
      case 6:
      case 7:
        return 0;
      case 16:
      case 8:
        return -28;
      case 9:
        return G[Tb() >> 2] = 28, -1;
      default:
        return -28;
    }
  } catch (g) {
    if ("undefined" == typeof Q || !(g instanceof Q.g)) {
      throw g;
    }
    return -g.l;
  }
}, __syscall_fstat64:function(a, b) {
  try {
    var c = V(a);
    return Db(Q.stat, c.path, b);
  } catch (e) {
    if ("undefined" == typeof Q || !(e instanceof Q.g)) {
      throw e;
    }
    return -e.l;
  }
}, __syscall_getdents64:function(a, b, c) {
  try {
    var e = V(a);
    e.X || (e.X = Q.readdir(e.path));
    a = 0;
    for (var f = Q.C(e, 0, 1), g = Math.floor(f / 280); g < e.X.length && a + 280 <= c;) {
      var l = e.X[g];
      if ("." === l) {
        var n = e.node.id;
        var t = 4;
      } else if (".." === l) {
        n = Q.o(e.path, {parent:!0}).node.id, t = 4;
      } else {
        var r = Q.K(e.node, l);
        n = r.id;
        t = Q.na(r.mode) ? 2 : Q.v(r.mode) ? 4 : Q.T(r.mode) ? 10 : 8;
      }
      assert(n);
      Ka[b + a >> 3] = BigInt(n);
      Ka[b + a + 8 >> 3] = BigInt(280 * (g + 1));
      Ja[b + a + 16 >> 1] = 280;
      E[b + a + 18 >> 0] = t;
      f = l;
      var u = b + a + 19;
      assert(!0, "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
      Ba(f, Aa, u, 256);
      a += 280;
      g += 1;
    }
    Q.C(e, 280 * g, 0);
    return a;
  } catch (B) {
    if ("undefined" == typeof Q || !(B instanceof Q.g)) {
      throw B;
    }
    return -B.l;
  }
}, __syscall_ioctl:function(a, b, c) {
  Eb = c;
  try {
    var e = V(a);
    switch(b) {
      case 21509:
      case 21505:
        return e.tty ? 0 : -59;
      case 21510:
      case 21511:
      case 21512:
      case 21506:
      case 21507:
      case 21508:
        return e.tty ? 0 : -59;
      case 21519:
        if (!e.tty) {
          return -59;
        }
        var f = Fb();
        return G[f >> 2] = 0;
      case 21520:
        return e.tty ? -28 : -59;
      case 21531:
        return f = Fb(), Q.wa(e, b, f);
      case 21523:
        return e.tty ? 0 : -59;
      case 21524:
        return e.tty ? 0 : -59;
      default:
        h("bad ioctl syscall " + b);
    }
  } catch (g) {
    if ("undefined" == typeof Q || !(g instanceof Q.g)) {
      throw g;
    }
    return -g.l;
  }
}, __syscall_lstat64:function(a, b) {
  try {
    return a = D(a), Db(Q.lstat, a, b);
  } catch (c) {
    if ("undefined" == typeof Q || !(c instanceof Q.g)) {
      throw c;
    }
    return -c.l;
  }
}, __syscall_newfstatat:function(a, b, c, e) {
  try {
    b = D(b);
    var f = e & 256, g = e & 4096;
    e &= -4353;
    assert(!e, e);
    b = Cb(a, b, g);
    return Db(f ? Q.lstat : Q.stat, b, c);
  } catch (l) {
    if ("undefined" == typeof Q || !(l instanceof Q.g)) {
      throw l;
    }
    return -l.l;
  }
}, __syscall_openat:function(a, b, c, e) {
  Eb = e;
  try {
    b = D(b);
    b = Cb(a, b);
    var f = e ? Fb() : 0;
    return Q.open(b, c, f).fd;
  } catch (g) {
    if ("undefined" == typeof Q || !(g instanceof Q.g)) {
      throw g;
    }
    return -g.l;
  }
}, __syscall_pipe:function(a) {
  try {
    if (0 == a) {
      throw new Q.g(21);
    }
    var b = W.Fb();
    G[a >> 2] = b.bc;
    G[a + 4 >> 2] = b.kc;
    return 0;
  } catch (c) {
    if ("undefined" == typeof Q || !(c instanceof Q.g)) {
      throw c;
    }
    return -c.l;
  }
}, __syscall_renameat:function(a, b, c, e) {
  try {
    return b = D(b), e = D(e), b = Cb(a, b), e = Cb(c, e), Q.rename(b, e), 0;
  } catch (f) {
    if ("undefined" == typeof Q || !(f instanceof Q.g)) {
      throw f;
    }
    return -f.l;
  }
}, __syscall_rmdir:function(a) {
  try {
    return a = D(a), Q.rmdir(a), 0;
  } catch (b) {
    if ("undefined" == typeof Q || !(b instanceof Q.g)) {
      throw b;
    }
    return -b.l;
  }
}, __syscall_stat64:function(a, b) {
  try {
    return a = D(a), Db(Q.stat, a, b);
  } catch (c) {
    if ("undefined" == typeof Q || !(c instanceof Q.g)) {
      throw c;
    }
    return -c.l;
  }
}, __syscall_unlinkat:function(a, b, c) {
  try {
    return b = D(b), b = Cb(a, b), 0 === c ? Q.unlink(b) : 512 === c ? Q.rmdir(b) : h("Invalid flags passed to unlinkat"), 0;
  } catch (e) {
    if ("undefined" == typeof Q || !(e instanceof Q.g)) {
      throw e;
    }
    return -e.l;
  }
}, _dlinit:function() {
}, _dlopen_js:function() {
  h("To use dlopen, you need enable dynamic linking, see https://github.com/emscripten-core/emscripten/wiki/Linking");
}, _dlsym_js:function() {
  h("To use dlopen, you need enable dynamic linking, see https://github.com/emscripten-core/emscripten/wiki/Linking");
}, _emscripten_date_now:function() {
  return Date.now();
}, _emscripten_get_now_is_monotonic:function() {
  return !0;
}, _emscripten_throw_longjmp:function() {
  throw Infinity;
}, _gmtime_js:function(a, b) {
  a = new Date(1000 * G[a >> 2]);
  G[b >> 2] = a.getUTCSeconds();
  G[b + 4 >> 2] = a.getUTCMinutes();
  G[b + 8 >> 2] = a.getUTCHours();
  G[b + 12 >> 2] = a.getUTCDate();
  G[b + 16 >> 2] = a.getUTCMonth();
  G[b + 20 >> 2] = a.getUTCFullYear() - 1900;
  G[b + 24 >> 2] = a.getUTCDay();
  G[b + 28 >> 2] = (a.getTime() - Date.UTC(a.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 864E5 | 0;
}, _localtime_js:function(a, b) {
  a = new Date(1000 * G[a >> 2]);
  G[b >> 2] = a.getSeconds();
  G[b + 4 >> 2] = a.getMinutes();
  G[b + 8 >> 2] = a.getHours();
  G[b + 12 >> 2] = a.getDate();
  G[b + 16 >> 2] = a.getMonth();
  G[b + 20 >> 2] = a.getFullYear() - 1900;
  G[b + 24 >> 2] = a.getDay();
  var c = new Date(a.getFullYear(), 0, 1);
  G[b + 28 >> 2] = (a.getTime() - c.getTime()) / 864E5 | 0;
  G[b + 36 >> 2] = -(60 * a.getTimezoneOffset());
  var e = (new Date(a.getFullYear(), 6, 1)).getTimezoneOffset();
  c = c.getTimezoneOffset();
  G[b + 32 >> 2] = (e != c && a.getTimezoneOffset() == Math.min(c, e)) | 0;
}, _mktime_js:function(a) {
  var b = new Date(G[a + 20 >> 2] + 1900, G[a + 16 >> 2], G[a + 12 >> 2], G[a + 8 >> 2], G[a + 4 >> 2], G[a >> 2], 0), c = G[a + 32 >> 2], e = b.getTimezoneOffset(), f = new Date(b.getFullYear(), 0, 1), g = (new Date(b.getFullYear(), 6, 1)).getTimezoneOffset(), l = f.getTimezoneOffset(), n = Math.min(l, g);
  0 > c ? G[a + 32 >> 2] = Number(g != l && n == e) : 0 < c != (n == e) && (g = Math.max(l, g), b.setTime(b.getTime() + 60000 * ((0 < c ? n : g) - e)));
  G[a + 24 >> 2] = b.getDay();
  G[a + 28 >> 2] = (b.getTime() - f.getTime()) / 864E5 | 0;
  G[a >> 2] = b.getSeconds();
  G[a + 4 >> 2] = b.getMinutes();
  G[a + 8 >> 2] = b.getHours();
  G[a + 12 >> 2] = b.getDate();
  G[a + 16 >> 2] = b.getMonth();
  return b.getTime() / 1000 | 0;
}, _tzset_js:Hb, abort:function() {
  h("native code called abort()");
}, emscripten_get_now:Ib, emscripten_memcpy_big:function(a, b, c) {
  Aa.copyWithin(a, b, b + c);
}, emscripten_resize_heap:function(a) {
  var b = Aa.length;
  a >>>= 0;
  assert(a > b);
  if (2147483648 < a) {
    return v("Cannot enlarge memory, asked to go up to " + a + " bytes, but the limit is 2147483648 bytes!"), !1;
  }
  for (var c = 1; 4 >= c; c *= 2) {
    var e = b * (1 + 0.2 / c);
    e = Math.min(e, a + 100663296);
    var f = Math;
    e = Math.max(a, e);
    f = f.min.call(f, 2147483648, e + (65536 - e % 65536) % 65536);
    a: {
      e = f;
      try {
        va.grow(e - Ia.byteLength + 65535 >>> 16);
        La();
        var g = 1;
        break a;
      } catch (l) {
        v("emscripten_realloc_buffer: Attempted to grow heap from " + Ia.byteLength + " bytes to " + e + " bytes, but got error: " + l);
      }
      g = void 0;
    }
    if (g) {
      return !0;
    }
  }
  v("Failed to grow the heap from " + b + " bytes to " + f + " bytes, not enough memory!");
  return !1;
}, environ_get:function(a, b) {
  var c = 0;
  Kb().forEach(function(e, f) {
    var g = b + c;
    f = G[a + 4 * f >> 2] = g;
    for (g = 0; g < e.length; ++g) {
      assert(e.charCodeAt(g) === (e.charCodeAt(g) & 255)), E[f++ >> 0] = e.charCodeAt(g);
    }
    E[f >> 0] = 0;
    c += e.length + 1;
  });
  return 0;
}, environ_sizes_get:function(a, b) {
  var c = Kb();
  G[a >> 2] = c.length;
  var e = 0;
  c.forEach(function(f) {
    e += f.length + 1;
  });
  G[b >> 2] = e;
  return 0;
}, exit:function(a) {
  Ub(a);
}, fd_close:function(a) {
  try {
    var b = V(a);
    Q.close(b);
    return 0;
  } catch (c) {
    if ("undefined" == typeof Q || !(c instanceof Q.g)) {
      throw c;
    }
    return c.l;
  }
}, fd_fdstat_get:function(a, b) {
  try {
    var c = V(a);
    E[b >> 0] = c.tty ? 2 : Q.v(c.mode) ? 3 : Q.T(c.mode) ? 7 : 4;
    return 0;
  } catch (e) {
    if ("undefined" == typeof Q || !(e instanceof Q.g)) {
      throw e;
    }
    return e.l;
  }
}, fd_pread:function(a, b, c, e, f) {
  try {
    var g = Number(e & BigInt(4294967295)) | 0;
    assert(!(Number(e >> BigInt(32)) | 0), "offsets over 2^32 not yet supported");
    var l = V(a), n = Mb(l, b, c, g);
    G[f >> 2] = n;
    return 0;
  } catch (t) {
    if ("undefined" == typeof Q || !(t instanceof Q.g)) {
      throw t;
    }
    return t.l;
  }
}, fd_pwrite:function(a, b, c, e, f) {
  try {
    var g = Number(e & BigInt(4294967295)) | 0, l = Number(e >> BigInt(32)) | 0, n = V(a);
    assert(!l, "offsets over 2^32 not yet supported");
    var t = Nb(n, b, c, g);
    G[f >> 2] = t;
    return 0;
  } catch (r) {
    if ("undefined" == typeof Q || !(r instanceof Q.g)) {
      throw r;
    }
    return r.l;
  }
}, fd_read:function(a, b, c, e) {
  try {
    var f = V(a), g = Mb(f, b, c);
    G[e >> 2] = g;
    return 0;
  } catch (l) {
    if ("undefined" == typeof Q || !(l instanceof Q.g)) {
      throw l;
    }
    return l.l;
  }
}, fd_seek:function(a, b, c, e) {
  try {
    var f = Number(b & BigInt(4294967295)) | 0, g = Number(b >> BigInt(32)) | 0, l = V(a);
    a = 4294967296 * g + (f >>> 0);
    if (-9007199254740992 >= a || 9007199254740992 <= a) {
      return 61;
    }
    Q.C(l, a, c);
    Ka[e >> 3] = BigInt(l.position);
    l.X && 0 === a && 0 === c && (l.X = null);
    return 0;
  } catch (n) {
    if ("undefined" == typeof Q || !(n instanceof Q.g)) {
      throw n;
    }
    return n.l;
  }
}, fd_write:function(a, b, c, e) {
  try {
    var f = V(a), g = Nb(f, b, c);
    G[e >> 2] = g;
    return 0;
  } catch (l) {
    if ("undefined" == typeof Q || !(l instanceof Q.g)) {
      throw l;
    }
    return l.l;
  }
}, getTempRet0:function() {
  return ua;
}, invoke_ii:Vb, invoke_iii:Wb, invoke_iiii:Yb, invoke_iiiii:Zb, invoke_iiiiiiiii:$b, invoke_iiji:ac, invoke_vi:bc, invoke_vii:cc, invoke_viii:dc, invoke_viiii:ec, invoke_viiiii:fc, invoke_viiiiii:gc, setTempRet0:function(a) {
  ua = a;
}, strftime:function(a, b, c, e) {
  function f(m, x, z) {
    for (m = "number" == typeof m ? m.toString() : m || ""; m.length < x;) {
      m = z[0] + m;
    }
    return m;
  }
  function g(m, x) {
    return f(m, x, "0");
  }
  function l(m, x) {
    function z(T) {
      return 0 > T ? -1 : 0 < T ? 1 : 0;
    }
    var K;
    0 === (K = z(m.getFullYear() - x.getFullYear())) && 0 === (K = z(m.getMonth() - x.getMonth())) && (K = z(m.getDate() - x.getDate()));
    return K;
  }
  function n(m) {
    switch(m.getDay()) {
      case 0:
        return new Date(m.getFullYear() - 1, 11, 29);
      case 1:
        return m;
      case 2:
        return new Date(m.getFullYear(), 0, 3);
      case 3:
        return new Date(m.getFullYear(), 0, 2);
      case 4:
        return new Date(m.getFullYear(), 0, 1);
      case 5:
        return new Date(m.getFullYear() - 1, 11, 31);
      case 6:
        return new Date(m.getFullYear() - 1, 11, 30);
    }
  }
  function t(m) {
    var x = m.ba;
    for (m = new Date((new Date(m.da + 1900, 0, 1)).getTime()); 0 < x;) {
      var z = m.getMonth(), K = (Ob(m.getFullYear()) ? Pb : Qb)[z];
      if (x > K - m.getDate()) {
        x -= K - m.getDate() + 1, m.setDate(1), 11 > z ? m.setMonth(z + 1) : (m.setMonth(0), m.setFullYear(m.getFullYear() + 1));
      } else {
        m.setDate(m.getDate() + x);
        break;
      }
    }
    z = new Date(m.getFullYear() + 1, 0, 4);
    x = n(new Date(m.getFullYear(), 0, 4));
    z = n(z);
    return 0 >= l(x, m) ? 0 >= l(z, m) ? m.getFullYear() + 1 : m.getFullYear() : m.getFullYear() - 1;
  }
  var r = G[e + 40 >> 2];
  e = {hc:G[e >> 2], fc:G[e + 4 >> 2], Ca:G[e + 8 >> 2], Ya:G[e + 12 >> 2], Da:G[e + 16 >> 2], da:G[e + 20 >> 2], O:G[e + 24 >> 2], ba:G[e + 28 >> 2], Gc:G[e + 32 >> 2], ec:G[e + 36 >> 2], ic:r ? D(r) : ""};
  c = D(c);
  r = {"%c":"%a %b %d %H:%M:%S %Y", "%D":"%m/%d/%y", "%F":"%Y-%m-%d", "%h":"%b", "%r":"%I:%M:%S %p", "%R":"%H:%M", "%T":"%H:%M:%S", "%x":"%m/%d/%y", "%X":"%H:%M:%S", "%Ec":"%c", "%EC":"%C", "%Ex":"%m/%d/%y", "%EX":"%H:%M:%S", "%Ey":"%y", "%EY":"%Y", "%Od":"%d", "%Oe":"%e", "%OH":"%H", "%OI":"%I", "%Om":"%m", "%OM":"%M", "%OS":"%S", "%Ou":"%u", "%OU":"%U", "%OV":"%V", "%Ow":"%w", "%OW":"%W", "%Oy":"%y",};
  for (var u in r) {
    c = c.replace(new RegExp(u, "g"), r[u]);
  }
  var B = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "), F = "January February March April May June July August September October November December".split(" ");
  r = {"%a":function(m) {
    return B[m.O].substring(0, 3);
  }, "%A":function(m) {
    return B[m.O];
  }, "%b":function(m) {
    return F[m.Da].substring(0, 3);
  }, "%B":function(m) {
    return F[m.Da];
  }, "%C":function(m) {
    return g((m.da + 1900) / 100 | 0, 2);
  }, "%d":function(m) {
    return g(m.Ya, 2);
  }, "%e":function(m) {
    return f(m.Ya, 2, " ");
  }, "%g":function(m) {
    return t(m).toString().substring(2);
  }, "%G":function(m) {
    return t(m);
  }, "%H":function(m) {
    return g(m.Ca, 2);
  }, "%I":function(m) {
    m = m.Ca;
    0 == m ? m = 12 : 12 < m && (m -= 12);
    return g(m, 2);
  }, "%j":function(m) {
    for (var x = 0, z = 0; z <= m.Da - 1; x += (Ob(m.da + 1900) ? Pb : Qb)[z++]) {
    }
    return g(m.Ya + x, 3);
  }, "%m":function(m) {
    return g(m.Da + 1, 2);
  }, "%M":function(m) {
    return g(m.fc, 2);
  }, "%n":function() {
    return "\n";
  }, "%p":function(m) {
    return 0 <= m.Ca && 12 > m.Ca ? "AM" : "PM";
  }, "%S":function(m) {
    return g(m.hc, 2);
  }, "%t":function() {
    return "\t";
  }, "%u":function(m) {
    return m.O || 7;
  }, "%U":function(m) {
    return g(Math.floor((m.ba + 7 - m.O) / 7), 2);
  }, "%V":function(m) {
    var x = Math.floor((m.ba + 7 - (m.O + 6) % 7) / 7);
    2 >= (m.O + 371 - m.ba - 2) % 7 && x++;
    if (x) {
      53 == x && (z = (m.O + 371 - m.ba) % 7, 4 == z || 3 == z && Ob(m.da) || (x = 1));
    } else {
      x = 52;
      var z = (m.O + 7 - m.ba - 1) % 7;
      (4 == z || 5 == z && Ob(m.da % 400 - 1)) && x++;
    }
    return g(x, 2);
  }, "%w":function(m) {
    return m.O;
  }, "%W":function(m) {
    return g(Math.floor((m.ba + 7 - (m.O + 6) % 7) / 7), 2);
  }, "%y":function(m) {
    return (m.da + 1900).toString().substring(2);
  }, "%Y":function(m) {
    return m.da + 1900;
  }, "%z":function(m) {
    m = m.ec;
    var x = 0 <= m;
    m = Math.abs(m) / 60;
    return (x ? "+" : "-") + String("0000" + (m / 60 * 100 + m % 60)).slice(-4);
  }, "%Z":function(m) {
    return m.ic;
  }, "%%":function() {
    return "%";
  }};
  c = c.replace(/%%/g, "\x00\x00");
  for (u in r) {
    c.includes(u) && (c = c.replace(new RegExp(u, "g"), r[u](e)));
  }
  c = c.replace(/\0\0/g, "%");
  u = tb(c, !1);
  if (u.length > b) {
    return 0;
  }
  Ha(u, a);
  return u.length - 1;
}};
(function() {
  function a(g) {
    d.asm = g.exports;
    va = d.asm.memory;
    assert(va, "memory not found in wasm exports");
    La();
    Ma = d.asm.__indirect_function_table;
    assert(Ma, "table not found in wasm exports");
    Ta.unshift(d.asm.__wasm_call_ctors);
    bb("wasm-instantiate");
  }
  function b(g) {
    assert(d === f, "the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?");
    f = null;
    a(g.instance);
  }
  function c(g) {
    return fb().then(function(l) {
      return WebAssembly.instantiate(l, e);
    }).then(function(l) {
      return l;
    }).then(g, function(l) {
      v("failed to asynchronously prepare wasm: " + l);
      J.startsWith("file://") && v("warning: Loading from a file URI (" + J + ") is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing");
      h(l);
    });
  }
  var e = {env:hc, wasi_snapshot_preview1:hc,};
  ab("wasm-instantiate");
  var f = d;
  if (d.instantiateWasm) {
    try {
      return d.instantiateWasm(e, a);
    } catch (g) {
      return v("Module.instantiateWasm callback failed with error: " + g), !1;
    }
  }
  (function() {
    return "function" != typeof WebAssembly.instantiateStreaming || cb() || J.startsWith("file://") || "function" != typeof fetch ? c(b) : fetch(J, {credentials:"same-origin"}).then(function(g) {
      return WebAssembly.instantiateStreaming(g, e).then(b, function(l) {
        v("wasm streaming compile failed: " + l);
        v("falling back to ArrayBuffer instantiation");
        return c(b);
      });
    });
  })().catch(ba);
  return {};
})();
d.___wasm_call_ctors = M("__wasm_call_ctors");
d._main = M("main");
var Tb = d.___errno_location = M("__errno_location");
d._free = M("free");
var Ea = d._malloc = M("malloc"), Ab = d.___stdio_exit = M("__stdio_exit");
d.___dl_seterr = M("__dl_seterr");
var X = d._setThrew = M("setThrew");
d._saveSetjmp = M("saveSetjmp");
var ic = d._emscripten_stack_init = function() {
  return (ic = d._emscripten_stack_init = d.asm.emscripten_stack_init).apply(null, arguments);
};
d._emscripten_stack_get_free = function() {
  return (d._emscripten_stack_get_free = d.asm.emscripten_stack_get_free).apply(null, arguments);
};
d._emscripten_stack_get_base = function() {
  return (d._emscripten_stack_get_base = d.asm.emscripten_stack_get_base).apply(null, arguments);
};
var Oa = d._emscripten_stack_get_end = function() {
  return (Oa = d._emscripten_stack_get_end = d.asm.emscripten_stack_get_end).apply(null, arguments);
}, Y = d.stackSave = M("stackSave"), Z = d.stackRestore = M("stackRestore"), Ga = d.stackAlloc = M("stackAlloc"), Sb = d.___cxa_can_catch = M("__cxa_can_catch");
d.___cxa_is_pointer_type = M("__cxa_is_pointer_type");
d.dynCall_jiji = M("dynCall_jiji");
var jc = d.dynCall_iiii = M("dynCall_iiii"), kc = d.dynCall_ii = M("dynCall_ii");
d.dynCall_iidiiii = M("dynCall_iidiiii");
var dynCall_vii = d.dynCall_vii = M("dynCall_vii"), dynCall_vi = d.dynCall_vi = M("dynCall_vi"), lc = d.dynCall_viiiiii = M("dynCall_viiiiii"), mc = d.dynCall_viiiii = M("dynCall_viiiii"), nc = d.dynCall_viiii = M("dynCall_viiii"), oc = d.dynCall_iiiii = M("dynCall_iiiii");
d.dynCall_iiiiiii = M("dynCall_iiiiiii");
var pc = d.dynCall_viii = M("dynCall_viii"), qc = d.dynCall_iiiiiiiii = M("dynCall_iiiiiiiii");
d.dynCall_iiiiiiiiiiii = M("dynCall_iiiiiiiiiiii");
d.dynCall_iiiiiiiiiii = M("dynCall_iiiiiiiiiii");
d.dynCall_iiiiiiiiiiiiiiiii = M("dynCall_iiiiiiiiiiiiiiiii");
var dynCall_iii = d.dynCall_iii = M("dynCall_iii");
d.dynCall_iiiiiiiiii = M("dynCall_iiiiiiiiii");
d.dynCall_iiiiii = M("dynCall_iiiiii");
var rc = d.dynCall_iiji = M("dynCall_iiji");
d.dynCall_jii = M("dynCall_jii");
d.dynCall_iiiiiiijjii = M("dynCall_iiiiiiijjii");
d.dynCall_iiiiiiiiiiji = M("dynCall_iiiiiiiiiiji");
d.dynCall_iiiiiiiiiijj = M("dynCall_iiiiiiiiiijj");
d.dynCall_iiiiiij = M("dynCall_iiiiiij");
d.dynCall_iiiiiiiiiiiiii = M("dynCall_iiiiiiiiiiiiii");
d.dynCall_iddii = M("dynCall_iddii");
d.dynCall_fdi = M("dynCall_fdi");
d.dynCall_fdii = M("dynCall_fdii");
d.dynCall_iiiiiiii = M("dynCall_iiiiiiii");
d.dynCall_viiiiiiiiijiiii = M("dynCall_viiiiiiiiijiiii");
d.dynCall_iiijiii = M("dynCall_iiijiii");
d.dynCall_iijiii = M("dynCall_iijiii");
d.dynCall_iij = M("dynCall_iij");
d.dynCall_iidiii = M("dynCall_iidiii");
d.dynCall_viiiiiii = M("dynCall_viiiiiii");
d.dynCall_idii = M("dynCall_idii");
d.dynCall_iiiiiiiiiiiiiii = M("dynCall_iiiiiiiiiiiiiii");
d.dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiijiiiiii = M("dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiijiiiiii");
d.dynCall_viiiiiiiiiiiiiijiiiii = M("dynCall_viiiiiiiiiiiiiijiiiii");
d.dynCall_viiiiiiiii = M("dynCall_viiiiiiiii");
d.dynCall_jji = M("dynCall_jji");
d.dynCall_iji = M("dynCall_iji");
d.dynCall_viij = M("dynCall_viij");
d.dynCall_ji = M("dynCall_ji");
d.dynCall_iiiiiiiiiiiii = M("dynCall_iiiiiiiiiiiii");
d.dynCall_iijii = M("dynCall_iijii");
d.dynCall_iiiiiiiiiiiiiiii = M("dynCall_iiiiiiiiiiiiiiii");
d.dynCall_viiiiiiii = M("dynCall_viiiiiiii");
d.dynCall_fdd = M("dynCall_fdd");
d.dynCall_iidd = M("dynCall_iidd");
d.dynCall_iiiij = M("dynCall_iiiij");
d.dynCall_iid = M("dynCall_iid");
d.dynCall_di = M("dynCall_di");
d.dynCall_iiddi = M("dynCall_iiddi");
d.dynCall_iidddddd = M("dynCall_iidddddd");
d.dynCall_iiddddd = M("dynCall_iiddddd");
d.dynCall_fi = M("dynCall_fi");
d.dynCall_iiiijj = M("dynCall_iiiijj");
d.dynCall_iiiiijiiii = M("dynCall_iiiiijiiii");
d.dynCall_iiiiiiiifi = M("dynCall_iiiiiiiifi");
d.dynCall_iiiijii = M("dynCall_iiiijii");
d.dynCall_iiiiijiiiii = M("dynCall_iiiiijiiiii");
d.dynCall_vijii = M("dynCall_vijii");
d.dynCall_diiid = M("dynCall_diiid");
d.dynCall_iidi = M("dynCall_iidi");
d.dynCall_iiiid = M("dynCall_iiiid");
d.dynCall_iiddddi = M("dynCall_iiddddi");
d.dynCall_iiddddddddi = M("dynCall_iiddddddddi");
d.dynCall_ddd = M("dynCall_ddd");
d.dynCall_iijj = M("dynCall_iijj");
d.dynCall_iiiji = M("dynCall_iiiji");
d.dynCall_iijjjjjj = M("dynCall_iijjjjjj");
d.dynCall_dd = M("dynCall_dd");
d.dynCall_id = M("dynCall_id");
d.dynCall_iiijii = M("dynCall_iiijii");
d.dynCall_iiiijiiii = M("dynCall_iiiijiiii");
function cc(a, b, c) {
  var e = Y();
  try {
    dynCall_vii(a, b, c);
  } catch (f) {
    Z(e);
    if (f !== f + 0) {
      throw f;
    }
    X(1, 0);
  }
}
function Vb(a, b) {
  var c = Y();
  try {
    return kc(a, b);
  } catch (e) {
    Z(c);
    if (e !== e + 0) {
      throw e;
    }
    X(1, 0);
  }
}
function Wb(a, b, c) {
  var e = Y();
  try {
    return dynCall_iii(a, b, c);
  } catch (f) {
    Z(e);
    if (f !== f + 0) {
      throw f;
    }
    X(1, 0);
  }
}
function bc(a, b) {
  var c = Y();
  try {
    dynCall_vi(a, b);
  } catch (e) {
    Z(c);
    if (e !== e + 0) {
      throw e;
    }
    X(1, 0);
  }
}
function Yb(a, b, c, e) {
  var f = Y();
  try {
    return jc(a, b, c, e);
  } catch (g) {
    Z(f);
    if (g !== g + 0) {
      throw g;
    }
    X(1, 0);
  }
}
function ec(a, b, c, e, f) {
  var g = Y();
  try {
    nc(a, b, c, e, f);
  } catch (l) {
    Z(g);
    if (l !== l + 0) {
      throw l;
    }
    X(1, 0);
  }
}
function dc(a, b, c, e) {
  var f = Y();
  try {
    pc(a, b, c, e);
  } catch (g) {
    Z(f);
    if (g !== g + 0) {
      throw g;
    }
    X(1, 0);
  }
}
function ac(a, b, c, e) {
  var f = Y();
  try {
    return rc(a, b, c, e);
  } catch (g) {
    Z(f);
    if (g !== g + 0) {
      throw g;
    }
    X(1, 0);
  }
}
function Zb(a, b, c, e, f) {
  var g = Y();
  try {
    return oc(a, b, c, e, f);
  } catch (l) {
    Z(g);
    if (l !== l + 0) {
      throw l;
    }
    X(1, 0);
  }
}
function gc(a, b, c, e, f, g, l) {
  var n = Y();
  try {
    lc(a, b, c, e, f, g, l);
  } catch (t) {
    Z(n);
    if (t !== t + 0) {
      throw t;
    }
    X(1, 0);
  }
}
function fc(a, b, c, e, f, g) {
  var l = Y();
  try {
    mc(a, b, c, e, f, g);
  } catch (n) {
    Z(l);
    if (n !== n + 0) {
      throw n;
    }
    X(1, 0);
  }
}
function $b(a, b, c, e, f, g, l, n, t) {
  var r = Y();
  try {
    return qc(a, b, c, e, f, g, l, n, t);
  } catch (u) {
    Z(r);
    if (u !== u + 0) {
      throw u;
    }
    X(1, 0);
  }
}
C("ccall", !1);
C("cwrap", !1);
C("setValue", !1);
C("getValue", !1);
C("allocate", !1);
C("UTF8ArrayToString", !1);
C("UTF8ToString", !1);
C("stringToUTF8Array", !1);
C("stringToUTF8", !1);
C("lengthBytesUTF8", !1);
C("addOnPreRun", !1);
C("addOnInit", !1);
C("addOnPreMain", !1);
C("addOnExit", !1);
C("addOnPostRun", !1);
C("addRunDependency", !0);
C("removeRunDependency", !0);
C("FS_createFolder", !1);
C("FS_createPath", !0);
C("FS_createDataFile", !0);
C("FS_createPreloadedFile", !0);
C("FS_createLazyFile", !0);
C("FS_createLink", !1);
C("FS_createDevice", !0);
C("FS_unlink", !0);
C("getLEB", !1);
C("getFunctionTables", !1);
C("alignFunctionTables", !1);
C("registerFunctions", !1);
C("addFunction", !1);
C("removeFunction", !1);
C("prettyPrint", !1);
C("getCompilerSetting", !1);
C("print", !1);
C("printErr", !1);
C("getTempRet0", !1);
C("setTempRet0", !1);
d.callMain = sc;
C("abort", !1);
C("keepRuntimeAlive", !1);
C("wasmMemory", !1);
C("warnOnce", !1);
C("stackSave", !1);
C("stackRestore", !1);
C("stackAlloc", !1);
C("AsciiToString", !1);
C("stringToAscii", !1);
C("UTF16ToString", !1);
C("stringToUTF16", !1);
C("lengthBytesUTF16", !1);
C("UTF32ToString", !1);
C("stringToUTF32", !1);
C("lengthBytesUTF32", !1);
C("allocateUTF8", !1);
C("allocateUTF8OnStack", !1);
C("ExitStatus", !1);
C("intArrayFromString", !1);
C("intArrayToString", !1);
C("writeStringToMemory", !1);
C("writeArrayToMemory", !1);
C("writeAsciiToMemory", !1);
d.writeStackCookie = Na;
d.checkStackCookie = Pa;
C("ptrToString", !1);
C("zeroMemory", !1);
C("stringToNewUTF8", !1);
C("emscripten_realloc_buffer", !1);
d.ENV = Jb;
C("ERRNO_CODES", !1);
C("ERRNO_MESSAGES", !1);
C("setErrNo", !1);
C("inetPton4", !1);
C("inetNtop4", !1);
C("inetPton6", !1);
C("inetNtop6", !1);
C("readSockaddr", !1);
C("writeSockaddr", !1);
C("DNS", !1);
C("getHostByName", !1);
C("Protocols", !1);
C("Sockets", !1);
C("getRandomDevice", !1);
C("traverseStack", !1);
C("UNWIND_CACHE", !1);
C("convertPCtoSourceLocation", !1);
C("readAsmConstArgsArray", !1);
C("readAsmConstArgs", !1);
C("mainThreadEM_ASM", !1);
C("jstoi_q", !1);
C("jstoi_s", !1);
C("getExecutableName", !1);
C("listenOnce", !1);
C("autoResumeAudioContext", !1);
C("dynCallLegacy", !1);
C("getDynCaller", !1);
C("dynCall", !1);
C("handleException", !1);
C("runtimeKeepalivePush", !1);
C("runtimeKeepalivePop", !1);
C("callUserCallback", !1);
C("maybeExit", !1);
C("safeSetTimeout", !1);
C("asmjsMangle", !1);
C("asyncLoad", !1);
C("alignMemory", !1);
C("mmapAlloc", !1);
C("reallyNegative", !1);
C("unSign", !1);
C("reSign", !1);
C("formatString", !1);
C("PATH", !1);
C("PATH_FS", !1);
C("SYSCALLS", !1);
C("getSocketFromFD", !1);
C("getSocketAddress", !1);
C("JSEvents", !1);
C("registerKeyEventCallback", !1);
C("specialHTMLTargets", !1);
C("maybeCStringToJsString", !1);
C("findEventTarget", !1);
C("findCanvasEventTarget", !1);
C("getBoundingClientRect", !1);
C("fillMouseEventData", !1);
C("registerMouseEventCallback", !1);
C("registerWheelEventCallback", !1);
C("registerUiEventCallback", !1);
C("registerFocusEventCallback", !1);
C("fillDeviceOrientationEventData", !1);
C("registerDeviceOrientationEventCallback", !1);
C("fillDeviceMotionEventData", !1);
C("registerDeviceMotionEventCallback", !1);
C("screenOrientation", !1);
C("fillOrientationChangeEventData", !1);
C("registerOrientationChangeEventCallback", !1);
C("fillFullscreenChangeEventData", !1);
C("registerFullscreenChangeEventCallback", !1);
C("registerRestoreOldStyle", !1);
C("hideEverythingExceptGivenElement", !1);
C("restoreHiddenElements", !1);
C("setLetterbox", !1);
C("currentFullscreenStrategy", !1);
C("restoreOldWindowedStyle", !1);
C("softFullscreenResizeWebGLRenderTarget", !1);
C("doRequestFullscreen", !1);
C("fillPointerlockChangeEventData", !1);
C("registerPointerlockChangeEventCallback", !1);
C("registerPointerlockErrorEventCallback", !1);
C("requestPointerLock", !1);
C("fillVisibilityChangeEventData", !1);
C("registerVisibilityChangeEventCallback", !1);
C("registerTouchEventCallback", !1);
C("fillGamepadEventData", !1);
C("registerGamepadEventCallback", !1);
C("registerBeforeUnloadEventCallback", !1);
C("fillBatteryEventData", !1);
C("battery", !1);
C("registerBatteryEventCallback", !1);
C("setCanvasElementSize", !1);
C("getCanvasElementSize", !1);
C("demangle", !1);
C("demangleAll", !1);
C("jsStackTrace", !1);
C("stackTrace", !1);
C("getEnvStrings", !1);
C("checkWasiClock", !1);
C("doReadv", !1);
C("doWritev", !1);
C("writeI53ToI64", !1);
C("writeI53ToI64Clamped", !1);
C("writeI53ToI64Signaling", !1);
C("writeI53ToU64Clamped", !1);
C("writeI53ToU64Signaling", !1);
C("readI53FromI64", !1);
C("readI53FromU64", !1);
C("convertI32PairToI53", !1);
C("convertU32PairToI53", !1);
C("dlopenMissingError", !1);
C("setImmediateWrapped", !1);
C("clearImmediateWrapped", !1);
C("polyfillSetImmediate", !1);
C("uncaughtExceptionCount", !1);
C("exceptionLast", !1);
C("exceptionCaught", !1);
C("ExceptionInfo", !1);
C("exception_addRef", !1);
C("exception_decRef", !1);
C("formatException", !1);
C("Browser", !1);
C("setMainLoop", !1);
C("wget", !1);
d.FS = Q;
C("MEMFS", !1);
C("TTY", !1);
C("PIPEFS", !1);
C("SOCKFS", !1);
C("_setNetworkCallback", !1);
C("tempFixedLengthArray", !1);
C("miniTempWebGLFloatBuffers", !1);
C("heapObjectForWebGLType", !1);
C("heapAccessShiftForWebGLHeap", !1);
C("GL", !1);
C("emscriptenWebGLGet", !1);
C("computeUnpackAlignedImageSize", !1);
C("emscriptenWebGLGetTexPixelData", !1);
C("emscriptenWebGLGetUniform", !1);
C("webglGetUniformLocation", !1);
C("webglPrepareUniformLocationsBeforeFirstUse", !1);
C("webglGetLeftBracePos", !1);
C("emscriptenWebGLGetVertexAttrib", !1);
C("writeGLArray", !1);
C("AL", !1);
C("SDL_unicode", !1);
C("SDL_ttfContext", !1);
C("SDL_audio", !1);
C("SDL", !1);
C("SDL_gfx", !1);
C("GLUT", !1);
C("EGL", !1);
C("GLFW_Window", !1);
C("GLFW", !1);
C("GLEW", !1);
C("IDBStore", !1);
C("runAndAbortIfError", !1);
d.NODEFS = S;
d.WORKERFS = U;
ta("ALLOC_NORMAL");
ta("ALLOC_STACK");
var tc;
function na(a) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + a + ")";
  this.status = a;
}
Ya = function uc() {
  tc || vc();
  tc || (Ya = uc);
};
function sc(a) {
  assert(0 == Xa, 'cannot call main when async dependencies remain! (listen on Module["onRuntimeInitialized"])');
  assert(0 == Sa.length, "cannot call main when preRun functions remain to be called");
  var b = d._main;
  a = a || [];
  var c = a.length + 1, e = Ga(4 * (c + 1));
  G[e >> 2] = Fa(ea);
  for (var f = 1; f < c; f++) {
    G[(e >> 2) + f] = Fa(a[f - 1]);
  }
  G[(e >> 2) + c] = 0;
  try {
    var g = b(c, e);
    Ub(g, !0);
    return g;
  } catch (n) {
    if (n instanceof na || "unwind" == n) {
      var l = xa;
    } else {
      fa(1, n), l = void 0;
    }
    return l;
  } finally {
  }
}
function vc(a) {
  a = a || da;
  if (!(0 < Xa)) {
    ic();
    Na();
    if (d.preRun) {
      for ("function" == typeof d.preRun && (d.preRun = [d.preRun]); d.preRun.length;) {
        var b = d.preRun.shift();
        Sa.unshift(b);
      }
    }
    gb(Sa);
    0 < Xa || (tc || (tc = !0, d.calledRun = !0, wa || (Pa(), assert(!Wa), Wa = !0, d.noFSInit || Q.Y.va || Q.Y(), Q.Na = !1, W.root = Q.m(W, {}, null), gb(Ta), Pa(), gb(Ua), aa(d), wc && sc(a), Pa(), gb(Va))), Pa());
  }
}
d.run = vc;
function xc() {
  var a = w, b = v, c = !1;
  w = v = () => {
    c = !0;
  };
  try {
    Ab(), ["stdout", "stderr"].forEach(function(e) {
      (e = Q.ua("/dev/" + e)) && (e = qb[e.object.rdev]) && e.output && e.output.length && (c = !0);
    });
  } catch (e) {
  }
  w = a;
  v = b;
  c && qa("stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.");
}
function Ub(a, b) {
  xa = a;
  xc();
  noExitRuntime && !b && (b = "program exited (with status: " + a + "), but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)", ba(b), v(b));
  xa = a;
  noExitRuntime || (wa = !0);
  fa(a, new na(a));
}
var wc = !0;
d.noInitialRun && (wc = !1);
vc();
Object.assign(Q, {init:Q.Y, mkdir:Q.mkdir, mount:Q.m, chdir:Q.chdir, writeFile:Q.writeFile, readFile:Q.readFile, createLazyFile:Q.Eb, setIgnorePermissions:function(a) {
  Q.Na = a;
},});



  return Module.ready
}
);
})();
if (typeof exports === 'object' && typeof module === 'object')
  module.exports = Module;
else if (typeof define === 'function' && define['amd'])
  define([], function() { return Module; });
else if (typeof exports === 'object')
  exports["Module"] = Module;
