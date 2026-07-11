(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/pngjs/browser.js
  var require_browser = __commonJS({
    "node_modules/pngjs/browser.js"(exports, module) {
      (function(f) {
        if (typeof exports === "object" && typeof module !== "undefined") {
          module.exports = f();
        } else if (typeof define === "function" && define.amd) {
          define([], f);
        } else {
          var g;
          if (typeof window !== "undefined") {
            g = window;
          } else if (typeof global !== "undefined") {
            g = global;
          } else if (typeof self !== "undefined") {
            g = self;
          } else {
            g = this;
          }
          g.png = f();
        }
      })(function() {
        var define2, module2, exports2;
        return (/* @__PURE__ */ function() {
          function r(e, n, t) {
            function o(i2, f) {
              if (!n[i2]) {
                if (!e[i2]) {
                  var c = "function" == typeof __require && __require;
                  if (!f && c) return c(i2, true);
                  if (u) return u(i2, true);
                  var a = new Error("Cannot find module '" + i2 + "'");
                  throw a.code = "MODULE_NOT_FOUND", a;
                }
                var p = n[i2] = { exports: {} };
                e[i2][0].call(p.exports, function(r2) {
                  var n2 = e[i2][1][r2];
                  return o(n2 || r2);
                }, p, p.exports, r, e, n, t);
              }
              return n[i2].exports;
            }
            for (var u = "function" == typeof __require && __require, i = 0; i < t.length; i++) o(t[i]);
            return o;
          }
          return r;
        }())({ 1: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let interlaceUtils = require2("./interlace");
              let pixelBppMapper = [
                // 0 - dummy entry
                function() {
                },
                // 1 - L
                // 0: 0, 1: 0, 2: 0, 3: 0xff
                function(pxData, data, pxPos, rawPos) {
                  if (rawPos === data.length) {
                    throw new Error("Ran out of data");
                  }
                  let pixel = data[rawPos];
                  pxData[pxPos] = pixel;
                  pxData[pxPos + 1] = pixel;
                  pxData[pxPos + 2] = pixel;
                  pxData[pxPos + 3] = 255;
                },
                // 2 - LA
                // 0: 0, 1: 0, 2: 0, 3: 1
                function(pxData, data, pxPos, rawPos) {
                  if (rawPos + 1 >= data.length) {
                    throw new Error("Ran out of data");
                  }
                  let pixel = data[rawPos];
                  pxData[pxPos] = pixel;
                  pxData[pxPos + 1] = pixel;
                  pxData[pxPos + 2] = pixel;
                  pxData[pxPos + 3] = data[rawPos + 1];
                },
                // 3 - RGB
                // 0: 0, 1: 1, 2: 2, 3: 0xff
                function(pxData, data, pxPos, rawPos) {
                  if (rawPos + 2 >= data.length) {
                    throw new Error("Ran out of data");
                  }
                  pxData[pxPos] = data[rawPos];
                  pxData[pxPos + 1] = data[rawPos + 1];
                  pxData[pxPos + 2] = data[rawPos + 2];
                  pxData[pxPos + 3] = 255;
                },
                // 4 - RGBA
                // 0: 0, 1: 1, 2: 2, 3: 3
                function(pxData, data, pxPos, rawPos) {
                  if (rawPos + 3 >= data.length) {
                    throw new Error("Ran out of data");
                  }
                  pxData[pxPos] = data[rawPos];
                  pxData[pxPos + 1] = data[rawPos + 1];
                  pxData[pxPos + 2] = data[rawPos + 2];
                  pxData[pxPos + 3] = data[rawPos + 3];
                }
              ];
              let pixelBppCustomMapper = [
                // 0 - dummy entry
                function() {
                },
                // 1 - L
                // 0: 0, 1: 0, 2: 0, 3: 0xff
                function(pxData, pixelData, pxPos, maxBit) {
                  let pixel = pixelData[0];
                  pxData[pxPos] = pixel;
                  pxData[pxPos + 1] = pixel;
                  pxData[pxPos + 2] = pixel;
                  pxData[pxPos + 3] = maxBit;
                },
                // 2 - LA
                // 0: 0, 1: 0, 2: 0, 3: 1
                function(pxData, pixelData, pxPos) {
                  let pixel = pixelData[0];
                  pxData[pxPos] = pixel;
                  pxData[pxPos + 1] = pixel;
                  pxData[pxPos + 2] = pixel;
                  pxData[pxPos + 3] = pixelData[1];
                },
                // 3 - RGB
                // 0: 0, 1: 1, 2: 2, 3: 0xff
                function(pxData, pixelData, pxPos, maxBit) {
                  pxData[pxPos] = pixelData[0];
                  pxData[pxPos + 1] = pixelData[1];
                  pxData[pxPos + 2] = pixelData[2];
                  pxData[pxPos + 3] = maxBit;
                },
                // 4 - RGBA
                // 0: 0, 1: 1, 2: 2, 3: 3
                function(pxData, pixelData, pxPos) {
                  pxData[pxPos] = pixelData[0];
                  pxData[pxPos + 1] = pixelData[1];
                  pxData[pxPos + 2] = pixelData[2];
                  pxData[pxPos + 3] = pixelData[3];
                }
              ];
              function bitRetriever(data, depth) {
                let leftOver = [];
                let i = 0;
                function split() {
                  if (i === data.length) {
                    throw new Error("Ran out of data");
                  }
                  let byte = data[i];
                  i++;
                  let byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
                  switch (depth) {
                    default:
                      throw new Error("unrecognised depth");
                    case 16:
                      byte2 = data[i];
                      i++;
                      leftOver.push((byte << 8) + byte2);
                      break;
                    case 4:
                      byte2 = byte & 15;
                      byte1 = byte >> 4;
                      leftOver.push(byte1, byte2);
                      break;
                    case 2:
                      byte4 = byte & 3;
                      byte3 = byte >> 2 & 3;
                      byte2 = byte >> 4 & 3;
                      byte1 = byte >> 6 & 3;
                      leftOver.push(byte1, byte2, byte3, byte4);
                      break;
                    case 1:
                      byte8 = byte & 1;
                      byte7 = byte >> 1 & 1;
                      byte6 = byte >> 2 & 1;
                      byte5 = byte >> 3 & 1;
                      byte4 = byte >> 4 & 1;
                      byte3 = byte >> 5 & 1;
                      byte2 = byte >> 6 & 1;
                      byte1 = byte >> 7 & 1;
                      leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
                      break;
                  }
                }
                return {
                  get: function(count) {
                    while (leftOver.length < count) {
                      split();
                    }
                    let returner = leftOver.slice(0, count);
                    leftOver = leftOver.slice(count);
                    return returner;
                  },
                  resetAfterLine: function() {
                    leftOver.length = 0;
                  },
                  end: function() {
                    if (i !== data.length) {
                      throw new Error("extra data found");
                    }
                  }
                };
              }
              function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
                let imageWidth = image.width;
                let imageHeight = image.height;
                let imagePass = image.index;
                for (let y = 0; y < imageHeight; y++) {
                  for (let x = 0; x < imageWidth; x++) {
                    let pxPos = getPxPos(x, y, imagePass);
                    pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
                    rawPos += bpp;
                  }
                }
                return rawPos;
              }
              function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
                let imageWidth = image.width;
                let imageHeight = image.height;
                let imagePass = image.index;
                for (let y = 0; y < imageHeight; y++) {
                  for (let x = 0; x < imageWidth; x++) {
                    let pixelData = bits.get(bpp);
                    let pxPos = getPxPos(x, y, imagePass);
                    pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
                  }
                  bits.resetAfterLine();
                }
              }
              exports3.dataToBitMap = function(data, bitmapInfo) {
                let width = bitmapInfo.width;
                let height = bitmapInfo.height;
                let depth = bitmapInfo.depth;
                let bpp = bitmapInfo.bpp;
                let interlace = bitmapInfo.interlace;
                let bits;
                if (depth !== 8) {
                  bits = bitRetriever(data, depth);
                }
                let pxData;
                if (depth <= 8) {
                  pxData = Buffer2.alloc(width * height * 4);
                } else {
                  pxData = new Uint16Array(width * height * 4);
                }
                let maxBit = Math.pow(2, depth) - 1;
                let rawPos = 0;
                let images;
                let getPxPos;
                if (interlace) {
                  images = interlaceUtils.getImagePasses(width, height);
                  getPxPos = interlaceUtils.getInterlaceIterator(width, height);
                } else {
                  let nonInterlacedPxPos = 0;
                  getPxPos = function() {
                    let returner = nonInterlacedPxPos;
                    nonInterlacedPxPos += 4;
                    return returner;
                  };
                  images = [{ width, height }];
                }
                for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
                  if (depth === 8) {
                    rawPos = mapImage8Bit(
                      images[imageIndex],
                      pxData,
                      getPxPos,
                      bpp,
                      data,
                      rawPos
                    );
                  } else {
                    mapImageCustomBit(
                      images[imageIndex],
                      pxData,
                      getPxPos,
                      bpp,
                      bits,
                      maxBit
                    );
                  }
                }
                if (depth === 8) {
                  if (rawPos !== data.length) {
                    throw new Error("extra data found");
                  }
                } else {
                  bits.end();
                }
                return pxData;
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./interlace": 11, "buffer": 32 }], 2: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let constants = require2("./constants");
              module3.exports = function(dataIn, width, height, options) {
                let outHasAlpha = [constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(
                  options.colorType
                ) !== -1;
                if (options.colorType === options.inputColorType) {
                  let bigEndian = function() {
                    let buffer = new ArrayBuffer(2);
                    new DataView(buffer).setInt16(
                      0,
                      256,
                      true
                      /* littleEndian */
                    );
                    return new Int16Array(buffer)[0] !== 256;
                  }();
                  if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
                    return dataIn;
                  }
                }
                let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
                let maxValue = 255;
                let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
                if (inBpp === 4 && !options.inputHasAlpha) {
                  inBpp = 3;
                }
                let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
                if (options.bitDepth === 16) {
                  maxValue = 65535;
                  outBpp *= 2;
                }
                let outData = Buffer2.alloc(width * height * outBpp);
                let inIndex = 0;
                let outIndex = 0;
                let bgColor = options.bgColor || {};
                if (bgColor.red === void 0) {
                  bgColor.red = maxValue;
                }
                if (bgColor.green === void 0) {
                  bgColor.green = maxValue;
                }
                if (bgColor.blue === void 0) {
                  bgColor.blue = maxValue;
                }
                function getRGBA() {
                  let red;
                  let green;
                  let blue;
                  let alpha = maxValue;
                  switch (options.inputColorType) {
                    case constants.COLORTYPE_COLOR_ALPHA:
                      alpha = data[inIndex + 3];
                      red = data[inIndex];
                      green = data[inIndex + 1];
                      blue = data[inIndex + 2];
                      break;
                    case constants.COLORTYPE_COLOR:
                      red = data[inIndex];
                      green = data[inIndex + 1];
                      blue = data[inIndex + 2];
                      break;
                    case constants.COLORTYPE_ALPHA:
                      alpha = data[inIndex + 1];
                      red = data[inIndex];
                      green = red;
                      blue = red;
                      break;
                    case constants.COLORTYPE_GRAYSCALE:
                      red = data[inIndex];
                      green = red;
                      blue = red;
                      break;
                    default:
                      throw new Error(
                        "input color type:" + options.inputColorType + " is not supported at present"
                      );
                  }
                  if (options.inputHasAlpha) {
                    if (!outHasAlpha) {
                      alpha /= maxValue;
                      red = Math.min(
                        Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0),
                        maxValue
                      );
                      green = Math.min(
                        Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0),
                        maxValue
                      );
                      blue = Math.min(
                        Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0),
                        maxValue
                      );
                    }
                  }
                  return { red, green, blue, alpha };
                }
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    let rgba = getRGBA(data, inIndex);
                    switch (options.colorType) {
                      case constants.COLORTYPE_COLOR_ALPHA:
                      case constants.COLORTYPE_COLOR:
                        if (options.bitDepth === 8) {
                          outData[outIndex] = rgba.red;
                          outData[outIndex + 1] = rgba.green;
                          outData[outIndex + 2] = rgba.blue;
                          if (outHasAlpha) {
                            outData[outIndex + 3] = rgba.alpha;
                          }
                        } else {
                          outData.writeUInt16BE(rgba.red, outIndex);
                          outData.writeUInt16BE(rgba.green, outIndex + 2);
                          outData.writeUInt16BE(rgba.blue, outIndex + 4);
                          if (outHasAlpha) {
                            outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                          }
                        }
                        break;
                      case constants.COLORTYPE_ALPHA:
                      case constants.COLORTYPE_GRAYSCALE: {
                        let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
                        if (options.bitDepth === 8) {
                          outData[outIndex] = grayscale;
                          if (outHasAlpha) {
                            outData[outIndex + 1] = rgba.alpha;
                          }
                        } else {
                          outData.writeUInt16BE(grayscale, outIndex);
                          if (outHasAlpha) {
                            outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                          }
                        }
                        break;
                      }
                      default:
                        throw new Error("unrecognised color Type " + options.colorType);
                    }
                    inIndex += inBpp;
                    outIndex += outBpp;
                  }
                }
                return outData;
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./constants": 4, "buffer": 32 }], 3: [function(require2, module3, exports3) {
          (function(process, Buffer2) {
            (function() {
              "use strict";
              let util = require2("util");
              let Stream = require2("stream");
              let ChunkStream = module3.exports = function() {
                Stream.call(this);
                this._buffers = [];
                this._buffered = 0;
                this._reads = [];
                this._paused = false;
                this._encoding = "utf8";
                this.writable = true;
              };
              util.inherits(ChunkStream, Stream);
              ChunkStream.prototype.read = function(length, callback) {
                this._reads.push({
                  length: Math.abs(length),
                  // if length < 0 then at most this length
                  allowLess: length < 0,
                  func: callback
                });
                process.nextTick(
                  function() {
                    this._process();
                    if (this._paused && this._reads && this._reads.length > 0) {
                      this._paused = false;
                      this.emit("drain");
                    }
                  }.bind(this)
                );
              };
              ChunkStream.prototype.write = function(data, encoding) {
                if (!this.writable) {
                  this.emit("error", new Error("Stream not writable"));
                  return false;
                }
                let dataBuffer;
                if (Buffer2.isBuffer(data)) {
                  dataBuffer = data;
                } else {
                  dataBuffer = Buffer2.from(data, encoding || this._encoding);
                }
                this._buffers.push(dataBuffer);
                this._buffered += dataBuffer.length;
                this._process();
                if (this._reads && this._reads.length === 0) {
                  this._paused = true;
                }
                return this.writable && !this._paused;
              };
              ChunkStream.prototype.end = function(data, encoding) {
                if (data) {
                  this.write(data, encoding);
                }
                this.writable = false;
                if (!this._buffers) {
                  return;
                }
                if (this._buffers.length === 0) {
                  this._end();
                } else {
                  this._buffers.push(null);
                  this._process();
                }
              };
              ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
              ChunkStream.prototype._end = function() {
                if (this._reads.length > 0) {
                  this.emit("error", new Error("Unexpected end of input"));
                }
                this.destroy();
              };
              ChunkStream.prototype.destroy = function() {
                if (!this._buffers) {
                  return;
                }
                this.writable = false;
                this._reads = null;
                this._buffers = null;
                this.emit("close");
              };
              ChunkStream.prototype._processReadAllowingLess = function(read) {
                this._reads.shift();
                let smallerBuf = this._buffers[0];
                if (smallerBuf.length > read.length) {
                  this._buffered -= read.length;
                  this._buffers[0] = smallerBuf.slice(read.length);
                  read.func.call(this, smallerBuf.slice(0, read.length));
                } else {
                  this._buffered -= smallerBuf.length;
                  this._buffers.shift();
                  read.func.call(this, smallerBuf);
                }
              };
              ChunkStream.prototype._processRead = function(read) {
                this._reads.shift();
                let pos = 0;
                let count = 0;
                let data = Buffer2.alloc(read.length);
                while (pos < read.length) {
                  let buf = this._buffers[count++];
                  let len = Math.min(buf.length, read.length - pos);
                  buf.copy(data, pos, 0, len);
                  pos += len;
                  if (len !== buf.length) {
                    this._buffers[--count] = buf.slice(len);
                  }
                }
                if (count > 0) {
                  this._buffers.splice(0, count);
                }
                this._buffered -= read.length;
                read.func.call(this, data);
              };
              ChunkStream.prototype._process = function() {
                try {
                  while (this._buffered > 0 && this._reads && this._reads.length > 0) {
                    let read = this._reads[0];
                    if (read.allowLess) {
                      this._processReadAllowingLess(read);
                    } else if (this._buffered >= read.length) {
                      this._processRead(read);
                    } else {
                      break;
                    }
                  }
                  if (this._buffers && !this.writable) {
                    this._end();
                  }
                } catch (ex) {
                  this.emit("error", ex);
                }
              };
            }).call(this);
          }).call(this, require2("_process"), require2("buffer").Buffer);
        }, { "_process": 63, "buffer": 32, "stream": 65, "util": 84 }], 4: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = {
            PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
            TYPE_IHDR: 1229472850,
            TYPE_IEND: 1229278788,
            TYPE_IDAT: 1229209940,
            TYPE_PLTE: 1347179589,
            TYPE_tRNS: 1951551059,
            // eslint-disable-line camelcase
            TYPE_gAMA: 1732332865,
            // eslint-disable-line camelcase
            // color-type bits
            COLORTYPE_GRAYSCALE: 0,
            COLORTYPE_PALETTE: 1,
            COLORTYPE_COLOR: 2,
            COLORTYPE_ALPHA: 4,
            // e.g. grayscale and alpha
            // color-type combinations
            COLORTYPE_PALETTE_COLOR: 3,
            COLORTYPE_COLOR_ALPHA: 6,
            COLORTYPE_TO_BPP_MAP: {
              0: 1,
              2: 3,
              3: 1,
              4: 2,
              6: 4
            },
            GAMMA_DIVISION: 1e5
          };
        }, {}], 5: [function(require2, module3, exports3) {
          "use strict";
          let crcTable = [];
          (function() {
            for (let i = 0; i < 256; i++) {
              let currentCrc = i;
              for (let j = 0; j < 8; j++) {
                if (currentCrc & 1) {
                  currentCrc = 3988292384 ^ currentCrc >>> 1;
                } else {
                  currentCrc = currentCrc >>> 1;
                }
              }
              crcTable[i] = currentCrc;
            }
          })();
          let CrcCalculator = module3.exports = function() {
            this._crc = -1;
          };
          CrcCalculator.prototype.write = function(data) {
            for (let i = 0; i < data.length; i++) {
              this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
            }
            return true;
          };
          CrcCalculator.prototype.crc32 = function() {
            return this._crc ^ -1;
          };
          CrcCalculator.crc32 = function(buf) {
            let crc = -1;
            for (let i = 0; i < buf.length; i++) {
              crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
            }
            return crc ^ -1;
          };
        }, {}], 6: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let paethPredictor = require2("./paeth-predictor");
              function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
                for (let x = 0; x < byteWidth; x++) {
                  rawData[rawPos + x] = pxData[pxPos + x];
                }
              }
              function filterSumNone(pxData, pxPos, byteWidth) {
                let sum = 0;
                let length = pxPos + byteWidth;
                for (let i = pxPos; i < length; i++) {
                  sum += Math.abs(pxData[i]);
                }
                return sum;
              }
              function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let val2 = pxData[pxPos + x] - left;
                  rawData[rawPos + x] = val2;
                }
              }
              function filterSumSub(pxData, pxPos, byteWidth, bpp) {
                let sum = 0;
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let val2 = pxData[pxPos + x] - left;
                  sum += Math.abs(val2);
                }
                return sum;
              }
              function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
                for (let x = 0; x < byteWidth; x++) {
                  let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
                  let val2 = pxData[pxPos + x] - up;
                  rawData[rawPos + x] = val2;
                }
              }
              function filterSumUp(pxData, pxPos, byteWidth) {
                let sum = 0;
                let length = pxPos + byteWidth;
                for (let x = pxPos; x < length; x++) {
                  let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
                  let val2 = pxData[x] - up;
                  sum += Math.abs(val2);
                }
                return sum;
              }
              function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
                  let val2 = pxData[pxPos + x] - (left + up >> 1);
                  rawData[rawPos + x] = val2;
                }
              }
              function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
                let sum = 0;
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
                  let val2 = pxData[pxPos + x] - (left + up >> 1);
                  sum += Math.abs(val2);
                }
                return sum;
              }
              function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
                  let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
                  let val2 = pxData[pxPos + x] - paethPredictor(left, up, upleft);
                  rawData[rawPos + x] = val2;
                }
              }
              function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
                let sum = 0;
                for (let x = 0; x < byteWidth; x++) {
                  let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
                  let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
                  let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
                  let val2 = pxData[pxPos + x] - paethPredictor(left, up, upleft);
                  sum += Math.abs(val2);
                }
                return sum;
              }
              let filters = {
                0: filterNone,
                1: filterSub,
                2: filterUp,
                3: filterAvg,
                4: filterPaeth
              };
              let filterSums = {
                0: filterSumNone,
                1: filterSumSub,
                2: filterSumUp,
                3: filterSumAvg,
                4: filterSumPaeth
              };
              module3.exports = function(pxData, width, height, options, bpp) {
                let filterTypes;
                if (!("filterType" in options) || options.filterType === -1) {
                  filterTypes = [0, 1, 2, 3, 4];
                } else if (typeof options.filterType === "number") {
                  filterTypes = [options.filterType];
                } else {
                  throw new Error("unrecognised filter types");
                }
                if (options.bitDepth === 16) {
                  bpp *= 2;
                }
                let byteWidth = width * bpp;
                let rawPos = 0;
                let pxPos = 0;
                let rawData = Buffer2.alloc((byteWidth + 1) * height);
                let sel = filterTypes[0];
                for (let y = 0; y < height; y++) {
                  if (filterTypes.length > 1) {
                    let min = Infinity;
                    for (let i = 0; i < filterTypes.length; i++) {
                      let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
                      if (sum < min) {
                        sel = filterTypes[i];
                        min = sum;
                      }
                    }
                  }
                  rawData[rawPos] = sel;
                  rawPos++;
                  filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
                  rawPos += byteWidth;
                  pxPos += byteWidth;
                }
                return rawData;
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./paeth-predictor": 15, "buffer": 32 }], 7: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let util = require2("util");
              let ChunkStream = require2("./chunkstream");
              let Filter = require2("./filter-parse");
              let FilterAsync = module3.exports = function(bitmapInfo) {
                ChunkStream.call(this);
                let buffers = [];
                let that = this;
                this._filter = new Filter(bitmapInfo, {
                  read: this.read.bind(this),
                  write: function(buffer) {
                    buffers.push(buffer);
                  },
                  complete: function() {
                    that.emit("complete", Buffer2.concat(buffers));
                  }
                });
                this._filter.start();
              };
              util.inherits(FilterAsync, ChunkStream);
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./chunkstream": 3, "./filter-parse": 9, "buffer": 32, "util": 84 }], 8: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let SyncReader = require2("./sync-reader");
              let Filter = require2("./filter-parse");
              exports3.process = function(inBuffer, bitmapInfo) {
                let outBuffers = [];
                let reader = new SyncReader(inBuffer);
                let filter = new Filter(bitmapInfo, {
                  read: reader.read.bind(reader),
                  write: function(bufferPart) {
                    outBuffers.push(bufferPart);
                  },
                  complete: function() {
                  }
                });
                filter.start();
                reader.process();
                return Buffer2.concat(outBuffers);
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./filter-parse": 9, "./sync-reader": 22, "buffer": 32 }], 9: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let interlaceUtils = require2("./interlace");
              let paethPredictor = require2("./paeth-predictor");
              function getByteWidth(width, bpp, depth) {
                let byteWidth = width * bpp;
                if (depth !== 8) {
                  byteWidth = Math.ceil(byteWidth / (8 / depth));
                }
                return byteWidth;
              }
              let Filter = module3.exports = function(bitmapInfo, dependencies) {
                let width = bitmapInfo.width;
                let height = bitmapInfo.height;
                let interlace = bitmapInfo.interlace;
                let bpp = bitmapInfo.bpp;
                let depth = bitmapInfo.depth;
                this.read = dependencies.read;
                this.write = dependencies.write;
                this.complete = dependencies.complete;
                this._imageIndex = 0;
                this._images = [];
                if (interlace) {
                  let passes = interlaceUtils.getImagePasses(width, height);
                  for (let i = 0; i < passes.length; i++) {
                    this._images.push({
                      byteWidth: getByteWidth(passes[i].width, bpp, depth),
                      height: passes[i].height,
                      lineIndex: 0
                    });
                  }
                } else {
                  this._images.push({
                    byteWidth: getByteWidth(width, bpp, depth),
                    height,
                    lineIndex: 0
                  });
                }
                if (depth === 8) {
                  this._xComparison = bpp;
                } else if (depth === 16) {
                  this._xComparison = bpp * 2;
                } else {
                  this._xComparison = 1;
                }
              };
              Filter.prototype.start = function() {
                this.read(
                  this._images[this._imageIndex].byteWidth + 1,
                  this._reverseFilterLine.bind(this)
                );
              };
              Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
                let xComparison = this._xComparison;
                let xBiggerThan = xComparison - 1;
                for (let x = 0; x < byteWidth; x++) {
                  let rawByte = rawData[1 + x];
                  let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
                  unfilteredLine[x] = rawByte + f1Left;
                }
              };
              Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
                let lastLine = this._lastLine;
                for (let x = 0; x < byteWidth; x++) {
                  let rawByte = rawData[1 + x];
                  let f2Up = lastLine ? lastLine[x] : 0;
                  unfilteredLine[x] = rawByte + f2Up;
                }
              };
              Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
                let xComparison = this._xComparison;
                let xBiggerThan = xComparison - 1;
                let lastLine = this._lastLine;
                for (let x = 0; x < byteWidth; x++) {
                  let rawByte = rawData[1 + x];
                  let f3Up = lastLine ? lastLine[x] : 0;
                  let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
                  let f3Add = Math.floor((f3Left + f3Up) / 2);
                  unfilteredLine[x] = rawByte + f3Add;
                }
              };
              Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
                let xComparison = this._xComparison;
                let xBiggerThan = xComparison - 1;
                let lastLine = this._lastLine;
                for (let x = 0; x < byteWidth; x++) {
                  let rawByte = rawData[1 + x];
                  let f4Up = lastLine ? lastLine[x] : 0;
                  let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
                  let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
                  let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
                  unfilteredLine[x] = rawByte + f4Add;
                }
              };
              Filter.prototype._reverseFilterLine = function(rawData) {
                let filter = rawData[0];
                let unfilteredLine;
                let currentImage = this._images[this._imageIndex];
                let byteWidth = currentImage.byteWidth;
                if (filter === 0) {
                  unfilteredLine = rawData.slice(1, byteWidth + 1);
                } else {
                  unfilteredLine = Buffer2.alloc(byteWidth);
                  switch (filter) {
                    case 1:
                      this._unFilterType1(rawData, unfilteredLine, byteWidth);
                      break;
                    case 2:
                      this._unFilterType2(rawData, unfilteredLine, byteWidth);
                      break;
                    case 3:
                      this._unFilterType3(rawData, unfilteredLine, byteWidth);
                      break;
                    case 4:
                      this._unFilterType4(rawData, unfilteredLine, byteWidth);
                      break;
                    default:
                      throw new Error("Unrecognised filter type - " + filter);
                  }
                }
                this.write(unfilteredLine);
                currentImage.lineIndex++;
                if (currentImage.lineIndex >= currentImage.height) {
                  this._lastLine = null;
                  this._imageIndex++;
                  currentImage = this._images[this._imageIndex];
                } else {
                  this._lastLine = unfilteredLine;
                }
                if (currentImage) {
                  this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
                } else {
                  this._lastLine = null;
                  this.complete();
                }
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./interlace": 11, "./paeth-predictor": 15, "buffer": 32 }], 10: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              function dePalette(indata, outdata, width, height, palette) {
                let pxPos = 0;
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    let color = palette[indata[pxPos]];
                    if (!color) {
                      throw new Error("index " + indata[pxPos] + " not in palette");
                    }
                    for (let i = 0; i < 4; i++) {
                      outdata[pxPos + i] = color[i];
                    }
                    pxPos += 4;
                  }
                }
              }
              function replaceTransparentColor(indata, outdata, width, height, transColor) {
                let pxPos = 0;
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    let makeTrans = false;
                    if (transColor.length === 1) {
                      if (transColor[0] === indata[pxPos]) {
                        makeTrans = true;
                      }
                    } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
                      makeTrans = true;
                    }
                    if (makeTrans) {
                      for (let i = 0; i < 4; i++) {
                        outdata[pxPos + i] = 0;
                      }
                    }
                    pxPos += 4;
                  }
                }
              }
              function scaleDepth(indata, outdata, width, height, depth) {
                let maxOutSample = 255;
                let maxInSample = Math.pow(2, depth) - 1;
                let pxPos = 0;
                for (let y = 0; y < height; y++) {
                  for (let x = 0; x < width; x++) {
                    for (let i = 0; i < 4; i++) {
                      outdata[pxPos + i] = Math.floor(
                        indata[pxPos + i] * maxOutSample / maxInSample + 0.5
                      );
                    }
                    pxPos += 4;
                  }
                }
              }
              module3.exports = function(indata, imageData, skipRescale = false) {
                let depth = imageData.depth;
                let width = imageData.width;
                let height = imageData.height;
                let colorType = imageData.colorType;
                let transColor = imageData.transColor;
                let palette = imageData.palette;
                let outdata = indata;
                if (colorType === 3) {
                  dePalette(indata, outdata, width, height, palette);
                } else {
                  if (transColor) {
                    replaceTransparentColor(indata, outdata, width, height, transColor);
                  }
                  if (depth !== 8 && !skipRescale) {
                    if (depth === 16) {
                      outdata = Buffer2.alloc(width * height * 4);
                    }
                    scaleDepth(indata, outdata, width, height, depth);
                  }
                }
                return outdata;
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "buffer": 32 }], 11: [function(require2, module3, exports3) {
          "use strict";
          let imagePasses = [
            {
              // pass 1 - 1px
              x: [0],
              y: [0]
            },
            {
              // pass 2 - 1px
              x: [4],
              y: [0]
            },
            {
              // pass 3 - 2px
              x: [0, 4],
              y: [4]
            },
            {
              // pass 4 - 4px
              x: [2, 6],
              y: [0, 4]
            },
            {
              // pass 5 - 8px
              x: [0, 2, 4, 6],
              y: [2, 6]
            },
            {
              // pass 6 - 16px
              x: [1, 3, 5, 7],
              y: [0, 2, 4, 6]
            },
            {
              // pass 7 - 32px
              x: [0, 1, 2, 3, 4, 5, 6, 7],
              y: [1, 3, 5, 7]
            }
          ];
          exports3.getImagePasses = function(width, height) {
            let images = [];
            let xLeftOver = width % 8;
            let yLeftOver = height % 8;
            let xRepeats = (width - xLeftOver) / 8;
            let yRepeats = (height - yLeftOver) / 8;
            for (let i = 0; i < imagePasses.length; i++) {
              let pass = imagePasses[i];
              let passWidth = xRepeats * pass.x.length;
              let passHeight = yRepeats * pass.y.length;
              for (let j = 0; j < pass.x.length; j++) {
                if (pass.x[j] < xLeftOver) {
                  passWidth++;
                } else {
                  break;
                }
              }
              for (let j = 0; j < pass.y.length; j++) {
                if (pass.y[j] < yLeftOver) {
                  passHeight++;
                } else {
                  break;
                }
              }
              if (passWidth > 0 && passHeight > 0) {
                images.push({ width: passWidth, height: passHeight, index: i });
              }
            }
            return images;
          };
          exports3.getInterlaceIterator = function(width) {
            return function(x, y, pass) {
              let outerXLeftOver = x % imagePasses[pass].x.length;
              let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
              let outerYLeftOver = y % imagePasses[pass].y.length;
              let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
              return outerX * 4 + outerY * width * 4;
            };
          };
        }, {}], 12: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let util = require2("util");
              let Stream = require2("stream");
              let constants = require2("./constants");
              let Packer = require2("./packer");
              let PackerAsync = module3.exports = function(opt) {
                Stream.call(this);
                let options = opt || {};
                this._packer = new Packer(options);
                this._deflate = this._packer.createDeflate();
                this.readable = true;
              };
              util.inherits(PackerAsync, Stream);
              PackerAsync.prototype.pack = function(data, width, height, gamma) {
                this.emit("data", Buffer2.from(constants.PNG_SIGNATURE));
                this.emit("data", this._packer.packIHDR(width, height));
                if (gamma) {
                  this.emit("data", this._packer.packGAMA(gamma));
                }
                let filteredData = this._packer.filterData(data, width, height);
                this._deflate.on("error", this.emit.bind(this, "error"));
                this._deflate.on(
                  "data",
                  function(compressedData) {
                    this.emit("data", this._packer.packIDAT(compressedData));
                  }.bind(this)
                );
                this._deflate.on(
                  "end",
                  function() {
                    this.emit("data", this._packer.packIEND());
                    this.emit("end");
                  }.bind(this)
                );
                this._deflate.end(filteredData);
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./constants": 4, "./packer": 14, "buffer": 32, "stream": 65, "util": 84 }], 13: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let hasSyncZlib = true;
              let zlib = require2("zlib");
              if (!zlib.deflateSync) {
                hasSyncZlib = false;
              }
              let constants = require2("./constants");
              let Packer = require2("./packer");
              module3.exports = function(metaData, opt) {
                if (!hasSyncZlib) {
                  throw new Error(
                    "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
                  );
                }
                let options = opt || {};
                let packer = new Packer(options);
                let chunks = [];
                chunks.push(Buffer2.from(constants.PNG_SIGNATURE));
                chunks.push(packer.packIHDR(metaData.width, metaData.height));
                if (metaData.gamma) {
                  chunks.push(packer.packGAMA(metaData.gamma));
                }
                let filteredData = packer.filterData(
                  metaData.data,
                  metaData.width,
                  metaData.height
                );
                let compressedData = zlib.deflateSync(
                  filteredData,
                  packer.getDeflateOptions()
                );
                filteredData = null;
                if (!compressedData || !compressedData.length) {
                  throw new Error("bad png - invalid compressed data response");
                }
                chunks.push(packer.packIDAT(compressedData));
                chunks.push(packer.packIEND());
                return Buffer2.concat(chunks);
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./constants": 4, "./packer": 14, "buffer": 32, "zlib": 31 }], 14: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let constants = require2("./constants");
              let CrcStream = require2("./crc");
              let bitPacker = require2("./bitpacker");
              let filter = require2("./filter-pack");
              let zlib = require2("zlib");
              let Packer = module3.exports = function(options) {
                this._options = options;
                options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
                options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
                options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
                options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
                options.deflateFactory = options.deflateFactory || zlib.createDeflate;
                options.bitDepth = options.bitDepth || 8;
                options.colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
                options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;
                if ([
                  constants.COLORTYPE_GRAYSCALE,
                  constants.COLORTYPE_COLOR,
                  constants.COLORTYPE_COLOR_ALPHA,
                  constants.COLORTYPE_ALPHA
                ].indexOf(options.colorType) === -1) {
                  throw new Error(
                    "option color type:" + options.colorType + " is not supported at present"
                  );
                }
                if ([
                  constants.COLORTYPE_GRAYSCALE,
                  constants.COLORTYPE_COLOR,
                  constants.COLORTYPE_COLOR_ALPHA,
                  constants.COLORTYPE_ALPHA
                ].indexOf(options.inputColorType) === -1) {
                  throw new Error(
                    "option input color type:" + options.inputColorType + " is not supported at present"
                  );
                }
                if (options.bitDepth !== 8 && options.bitDepth !== 16) {
                  throw new Error(
                    "option bit depth:" + options.bitDepth + " is not supported at present"
                  );
                }
              };
              Packer.prototype.getDeflateOptions = function() {
                return {
                  chunkSize: this._options.deflateChunkSize,
                  level: this._options.deflateLevel,
                  strategy: this._options.deflateStrategy
                };
              };
              Packer.prototype.createDeflate = function() {
                return this._options.deflateFactory(this.getDeflateOptions());
              };
              Packer.prototype.filterData = function(data, width, height) {
                let packedData = bitPacker(data, width, height, this._options);
                let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
                let filteredData = filter(packedData, width, height, this._options, bpp);
                return filteredData;
              };
              Packer.prototype._packChunk = function(type, data) {
                let len = data ? data.length : 0;
                let buf = Buffer2.alloc(len + 12);
                buf.writeUInt32BE(len, 0);
                buf.writeUInt32BE(type, 4);
                if (data) {
                  data.copy(buf, 8);
                }
                buf.writeInt32BE(
                  CrcStream.crc32(buf.slice(4, buf.length - 4)),
                  buf.length - 4
                );
                return buf;
              };
              Packer.prototype.packGAMA = function(gamma) {
                let buf = Buffer2.alloc(4);
                buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
                return this._packChunk(constants.TYPE_gAMA, buf);
              };
              Packer.prototype.packIHDR = function(width, height) {
                let buf = Buffer2.alloc(13);
                buf.writeUInt32BE(width, 0);
                buf.writeUInt32BE(height, 4);
                buf[8] = this._options.bitDepth;
                buf[9] = this._options.colorType;
                buf[10] = 0;
                buf[11] = 0;
                buf[12] = 0;
                return this._packChunk(constants.TYPE_IHDR, buf);
              };
              Packer.prototype.packIDAT = function(data) {
                return this._packChunk(constants.TYPE_IDAT, data);
              };
              Packer.prototype.packIEND = function() {
                return this._packChunk(constants.TYPE_IEND, null);
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./bitpacker": 2, "./constants": 4, "./crc": 5, "./filter-pack": 6, "buffer": 32, "zlib": 31 }], 15: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = function paethPredictor(left, above, upLeft) {
            let paeth = left + above - upLeft;
            let pLeft = Math.abs(paeth - left);
            let pAbove = Math.abs(paeth - above);
            let pUpLeft = Math.abs(paeth - upLeft);
            if (pLeft <= pAbove && pLeft <= pUpLeft) {
              return left;
            }
            if (pAbove <= pUpLeft) {
              return above;
            }
            return upLeft;
          };
        }, {}], 16: [function(require2, module3, exports3) {
          "use strict";
          let util = require2("util");
          let zlib = require2("zlib");
          let ChunkStream = require2("./chunkstream");
          let FilterAsync = require2("./filter-parse-async");
          let Parser = require2("./parser");
          let bitmapper = require2("./bitmapper");
          let formatNormaliser = require2("./format-normaliser");
          let ParserAsync = module3.exports = function(options) {
            ChunkStream.call(this);
            this._parser = new Parser(options, {
              read: this.read.bind(this),
              error: this._handleError.bind(this),
              metadata: this._handleMetaData.bind(this),
              gamma: this.emit.bind(this, "gamma"),
              palette: this._handlePalette.bind(this),
              transColor: this._handleTransColor.bind(this),
              finished: this._finished.bind(this),
              inflateData: this._inflateData.bind(this),
              simpleTransparency: this._simpleTransparency.bind(this),
              headersFinished: this._headersFinished.bind(this)
            });
            this._options = options;
            this.writable = true;
            this._parser.start();
          };
          util.inherits(ParserAsync, ChunkStream);
          ParserAsync.prototype._handleError = function(err) {
            this.emit("error", err);
            this.writable = false;
            this.destroy();
            if (this._inflate && this._inflate.destroy) {
              this._inflate.destroy();
            }
            if (this._filter) {
              this._filter.destroy();
              this._filter.on("error", function() {
              });
            }
            this.errord = true;
          };
          ParserAsync.prototype._inflateData = function(data) {
            if (!this._inflate) {
              if (this._bitmapInfo.interlace) {
                this._inflate = zlib.createInflate();
                this._inflate.on("error", this.emit.bind(this, "error"));
                this._filter.on("complete", this._complete.bind(this));
                this._inflate.pipe(this._filter);
              } else {
                let rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
                let imageSize = rowSize * this._bitmapInfo.height;
                let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
                this._inflate = zlib.createInflate({ chunkSize });
                let leftToInflate = imageSize;
                let emitError = this.emit.bind(this, "error");
                this._inflate.on("error", function(err) {
                  if (!leftToInflate) {
                    return;
                  }
                  emitError(err);
                });
                this._filter.on("complete", this._complete.bind(this));
                let filterWrite = this._filter.write.bind(this._filter);
                this._inflate.on("data", function(chunk) {
                  if (!leftToInflate) {
                    return;
                  }
                  if (chunk.length > leftToInflate) {
                    chunk = chunk.slice(0, leftToInflate);
                  }
                  leftToInflate -= chunk.length;
                  filterWrite(chunk);
                });
                this._inflate.on("end", this._filter.end.bind(this._filter));
              }
            }
            this._inflate.write(data);
          };
          ParserAsync.prototype._handleMetaData = function(metaData) {
            this._metaData = metaData;
            this._bitmapInfo = Object.create(metaData);
            this._filter = new FilterAsync(this._bitmapInfo);
          };
          ParserAsync.prototype._handleTransColor = function(transColor) {
            this._bitmapInfo.transColor = transColor;
          };
          ParserAsync.prototype._handlePalette = function(palette) {
            this._bitmapInfo.palette = palette;
          };
          ParserAsync.prototype._simpleTransparency = function() {
            this._metaData.alpha = true;
          };
          ParserAsync.prototype._headersFinished = function() {
            this.emit("metadata", this._metaData);
          };
          ParserAsync.prototype._finished = function() {
            if (this.errord) {
              return;
            }
            if (!this._inflate) {
              this.emit("error", "No Inflate block");
            } else {
              this._inflate.end();
            }
          };
          ParserAsync.prototype._complete = function(filteredData) {
            if (this.errord) {
              return;
            }
            let normalisedBitmapData;
            try {
              let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
              normalisedBitmapData = formatNormaliser(
                bitmapData,
                this._bitmapInfo,
                this._options.skipRescale
              );
              bitmapData = null;
            } catch (ex) {
              this._handleError(ex);
              return;
            }
            this.emit("parsed", normalisedBitmapData);
          };
        }, { "./bitmapper": 1, "./chunkstream": 3, "./filter-parse-async": 7, "./format-normaliser": 10, "./parser": 18, "util": 84, "zlib": 31 }], 17: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let hasSyncZlib = true;
              let zlib = require2("zlib");
              let inflateSync = require2("./sync-inflate");
              if (!zlib.deflateSync) {
                hasSyncZlib = false;
              }
              let SyncReader = require2("./sync-reader");
              let FilterSync = require2("./filter-parse-sync");
              let Parser = require2("./parser");
              let bitmapper = require2("./bitmapper");
              let formatNormaliser = require2("./format-normaliser");
              module3.exports = function(buffer, options) {
                if (!hasSyncZlib) {
                  throw new Error(
                    "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
                  );
                }
                let err;
                function handleError(_err_) {
                  err = _err_;
                }
                let metaData;
                function handleMetaData(_metaData_) {
                  metaData = _metaData_;
                }
                function handleTransColor(transColor) {
                  metaData.transColor = transColor;
                }
                function handlePalette(palette) {
                  metaData.palette = palette;
                }
                function handleSimpleTransparency() {
                  metaData.alpha = true;
                }
                let gamma;
                function handleGamma(_gamma_) {
                  gamma = _gamma_;
                }
                let inflateDataList = [];
                function handleInflateData(inflatedData2) {
                  inflateDataList.push(inflatedData2);
                }
                let reader = new SyncReader(buffer);
                let parser = new Parser(options, {
                  read: reader.read.bind(reader),
                  error: handleError,
                  metadata: handleMetaData,
                  gamma: handleGamma,
                  palette: handlePalette,
                  transColor: handleTransColor,
                  inflateData: handleInflateData,
                  simpleTransparency: handleSimpleTransparency
                });
                parser.start();
                reader.process();
                if (err) {
                  throw err;
                }
                let inflateData = Buffer2.concat(inflateDataList);
                inflateDataList.length = 0;
                let inflatedData;
                if (metaData.interlace) {
                  inflatedData = zlib.inflateSync(inflateData);
                } else {
                  let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
                  let imageSize = rowSize * metaData.height;
                  inflatedData = inflateSync(inflateData, {
                    chunkSize: imageSize,
                    maxLength: imageSize
                  });
                }
                inflateData = null;
                if (!inflatedData || !inflatedData.length) {
                  throw new Error("bad png - invalid inflate data response");
                }
                let unfilteredData = FilterSync.process(inflatedData, metaData);
                inflateData = null;
                let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
                unfilteredData = null;
                let normalisedBitmapData = formatNormaliser(
                  bitmapData,
                  metaData,
                  options.skipRescale
                );
                metaData.data = normalisedBitmapData;
                metaData.gamma = gamma || 0;
                return metaData;
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./bitmapper": 1, "./filter-parse-sync": 8, "./format-normaliser": 10, "./parser": 18, "./sync-inflate": 21, "./sync-reader": 22, "buffer": 32, "zlib": 31 }], 18: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              let constants = require2("./constants");
              let CrcCalculator = require2("./crc");
              let Parser = module3.exports = function(options, dependencies) {
                this._options = options;
                options.checkCRC = options.checkCRC !== false;
                this._hasIHDR = false;
                this._hasIEND = false;
                this._emittedHeadersFinished = false;
                this._palette = [];
                this._colorType = 0;
                this._chunks = {};
                this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
                this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
                this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
                this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
                this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
                this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
                this.read = dependencies.read;
                this.error = dependencies.error;
                this.metadata = dependencies.metadata;
                this.gamma = dependencies.gamma;
                this.transColor = dependencies.transColor;
                this.palette = dependencies.palette;
                this.parsed = dependencies.parsed;
                this.inflateData = dependencies.inflateData;
                this.finished = dependencies.finished;
                this.simpleTransparency = dependencies.simpleTransparency;
                this.headersFinished = dependencies.headersFinished || function() {
                };
              };
              Parser.prototype.start = function() {
                this.read(constants.PNG_SIGNATURE.length, this._parseSignature.bind(this));
              };
              Parser.prototype._parseSignature = function(data) {
                let signature = constants.PNG_SIGNATURE;
                for (let i = 0; i < signature.length; i++) {
                  if (data[i] !== signature[i]) {
                    this.error(new Error("Invalid file signature"));
                    return;
                  }
                }
                this.read(8, this._parseChunkBegin.bind(this));
              };
              Parser.prototype._parseChunkBegin = function(data) {
                let length = data.readUInt32BE(0);
                let type = data.readUInt32BE(4);
                let name = "";
                for (let i = 4; i < 8; i++) {
                  name += String.fromCharCode(data[i]);
                }
                let ancillary = Boolean(data[4] & 32);
                if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
                  this.error(new Error("Expected IHDR on beggining"));
                  return;
                }
                this._crc = new CrcCalculator();
                this._crc.write(Buffer2.from(name));
                if (this._chunks[type]) {
                  return this._chunks[type](length);
                }
                if (!ancillary) {
                  this.error(new Error("Unsupported critical chunk type " + name));
                  return;
                }
                this.read(length + 4, this._skipChunk.bind(this));
              };
              Parser.prototype._skipChunk = function() {
                this.read(8, this._parseChunkBegin.bind(this));
              };
              Parser.prototype._handleChunkEnd = function() {
                this.read(4, this._parseChunkEnd.bind(this));
              };
              Parser.prototype._parseChunkEnd = function(data) {
                let fileCrc = data.readInt32BE(0);
                let calcCrc = this._crc.crc32();
                if (this._options.checkCRC && calcCrc !== fileCrc) {
                  this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
                  return;
                }
                if (!this._hasIEND) {
                  this.read(8, this._parseChunkBegin.bind(this));
                }
              };
              Parser.prototype._handleIHDR = function(length) {
                this.read(length, this._parseIHDR.bind(this));
              };
              Parser.prototype._parseIHDR = function(data) {
                this._crc.write(data);
                let width = data.readUInt32BE(0);
                let height = data.readUInt32BE(4);
                let depth = data[8];
                let colorType = data[9];
                let compr = data[10];
                let filter = data[11];
                let interlace = data[12];
                if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
                  this.error(new Error("Unsupported bit depth " + depth));
                  return;
                }
                if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
                  this.error(new Error("Unsupported color type"));
                  return;
                }
                if (compr !== 0) {
                  this.error(new Error("Unsupported compression method"));
                  return;
                }
                if (filter !== 0) {
                  this.error(new Error("Unsupported filter method"));
                  return;
                }
                if (interlace !== 0 && interlace !== 1) {
                  this.error(new Error("Unsupported interlace method"));
                  return;
                }
                this._colorType = colorType;
                let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];
                this._hasIHDR = true;
                this.metadata({
                  width,
                  height,
                  depth,
                  interlace: Boolean(interlace),
                  palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
                  color: Boolean(colorType & constants.COLORTYPE_COLOR),
                  alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
                  bpp,
                  colorType
                });
                this._handleChunkEnd();
              };
              Parser.prototype._handlePLTE = function(length) {
                this.read(length, this._parsePLTE.bind(this));
              };
              Parser.prototype._parsePLTE = function(data) {
                this._crc.write(data);
                let entries = Math.floor(data.length / 3);
                for (let i = 0; i < entries; i++) {
                  this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255]);
                }
                this.palette(this._palette);
                this._handleChunkEnd();
              };
              Parser.prototype._handleTRNS = function(length) {
                this.simpleTransparency();
                this.read(length, this._parseTRNS.bind(this));
              };
              Parser.prototype._parseTRNS = function(data) {
                this._crc.write(data);
                if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
                  if (this._palette.length === 0) {
                    this.error(new Error("Transparency chunk must be after palette"));
                    return;
                  }
                  if (data.length > this._palette.length) {
                    this.error(new Error("More transparent colors than palette size"));
                    return;
                  }
                  for (let i = 0; i < data.length; i++) {
                    this._palette[i][3] = data[i];
                  }
                  this.palette(this._palette);
                }
                if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
                  this.transColor([data.readUInt16BE(0)]);
                }
                if (this._colorType === constants.COLORTYPE_COLOR) {
                  this.transColor([
                    data.readUInt16BE(0),
                    data.readUInt16BE(2),
                    data.readUInt16BE(4)
                  ]);
                }
                this._handleChunkEnd();
              };
              Parser.prototype._handleGAMA = function(length) {
                this.read(length, this._parseGAMA.bind(this));
              };
              Parser.prototype._parseGAMA = function(data) {
                this._crc.write(data);
                this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
                this._handleChunkEnd();
              };
              Parser.prototype._handleIDAT = function(length) {
                if (!this._emittedHeadersFinished) {
                  this._emittedHeadersFinished = true;
                  this.headersFinished();
                }
                this.read(-length, this._parseIDAT.bind(this, length));
              };
              Parser.prototype._parseIDAT = function(length, data) {
                this._crc.write(data);
                if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
                  throw new Error("Expected palette not found");
                }
                this.inflateData(data);
                let leftOverLength = length - data.length;
                if (leftOverLength > 0) {
                  this._handleIDAT(leftOverLength);
                } else {
                  this._handleChunkEnd();
                }
              };
              Parser.prototype._handleIEND = function(length) {
                this.read(length, this._parseIEND.bind(this));
              };
              Parser.prototype._parseIEND = function(data) {
                this._crc.write(data);
                this._hasIEND = true;
                this._handleChunkEnd();
                if (this.finished) {
                  this.finished();
                }
              };
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "./constants": 4, "./crc": 5, "buffer": 32 }], 19: [function(require2, module3, exports3) {
          "use strict";
          let parse = require2("./parser-sync");
          let pack = require2("./packer-sync");
          exports3.read = function(buffer, options) {
            return parse(buffer, options || {});
          };
          exports3.write = function(png2, options) {
            return pack(png2, options);
          };
        }, { "./packer-sync": 13, "./parser-sync": 17 }], 20: [function(require2, module3, exports3) {
          (function(process, Buffer2) {
            (function() {
              "use strict";
              let util = require2("util");
              let Stream = require2("stream");
              let Parser = require2("./parser-async");
              let Packer = require2("./packer-async");
              let PNGSync = require2("./png-sync");
              let PNG = exports3.PNG = function(options) {
                Stream.call(this);
                options = options || {};
                this.width = options.width | 0;
                this.height = options.height | 0;
                this.data = this.width > 0 && this.height > 0 ? Buffer2.alloc(4 * this.width * this.height) : null;
                if (options.fill && this.data) {
                  this.data.fill(0);
                }
                this.gamma = 0;
                this.readable = this.writable = true;
                this._parser = new Parser(options);
                this._parser.on("error", this.emit.bind(this, "error"));
                this._parser.on("close", this._handleClose.bind(this));
                this._parser.on("metadata", this._metadata.bind(this));
                this._parser.on("gamma", this._gamma.bind(this));
                this._parser.on(
                  "parsed",
                  function(data) {
                    this.data = data;
                    this.emit("parsed", data);
                  }.bind(this)
                );
                this._packer = new Packer(options);
                this._packer.on("data", this.emit.bind(this, "data"));
                this._packer.on("end", this.emit.bind(this, "end"));
                this._parser.on("close", this._handleClose.bind(this));
                this._packer.on("error", this.emit.bind(this, "error"));
              };
              util.inherits(PNG, Stream);
              PNG.sync = PNGSync;
              PNG.prototype.pack = function() {
                if (!this.data || !this.data.length) {
                  this.emit("error", "No data provided");
                  return this;
                }
                process.nextTick(
                  function() {
                    this._packer.pack(this.data, this.width, this.height, this.gamma);
                  }.bind(this)
                );
                return this;
              };
              PNG.prototype.parse = function(data, callback) {
                if (callback) {
                  let onParsed, onError;
                  onParsed = function(parsedData) {
                    this.removeListener("error", onError);
                    this.data = parsedData;
                    callback(null, this);
                  }.bind(this);
                  onError = function(err) {
                    this.removeListener("parsed", onParsed);
                    callback(err, null);
                  }.bind(this);
                  this.once("parsed", onParsed);
                  this.once("error", onError);
                }
                this.end(data);
                return this;
              };
              PNG.prototype.write = function(data) {
                this._parser.write(data);
                return true;
              };
              PNG.prototype.end = function(data) {
                this._parser.end(data);
              };
              PNG.prototype._metadata = function(metadata) {
                this.width = metadata.width;
                this.height = metadata.height;
                this.emit("metadata", metadata);
              };
              PNG.prototype._gamma = function(gamma) {
                this.gamma = gamma;
              };
              PNG.prototype._handleClose = function() {
                if (!this._parser.writable && !this._packer.readable) {
                  this.emit("close");
                }
              };
              PNG.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
                srcX |= 0;
                srcY |= 0;
                width |= 0;
                height |= 0;
                deltaX |= 0;
                deltaY |= 0;
                if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
                  throw new Error("bitblt reading outside image");
                }
                if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
                  throw new Error("bitblt writing outside image");
                }
                for (let y = 0; y < height; y++) {
                  src.data.copy(
                    dst.data,
                    (deltaY + y) * dst.width + deltaX << 2,
                    (srcY + y) * src.width + srcX << 2,
                    (srcY + y) * src.width + srcX + width << 2
                  );
                }
              };
              PNG.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
                PNG.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
                return this;
              };
              PNG.adjustGamma = function(src) {
                if (src.gamma) {
                  for (let y = 0; y < src.height; y++) {
                    for (let x = 0; x < src.width; x++) {
                      let idx = src.width * y + x << 2;
                      for (let i = 0; i < 3; i++) {
                        let sample = src.data[idx + i] / 255;
                        sample = Math.pow(sample, 1 / 2.2 / src.gamma);
                        src.data[idx + i] = Math.round(sample * 255);
                      }
                    }
                  }
                  src.gamma = 0;
                }
              };
              PNG.prototype.adjustGamma = function() {
                PNG.adjustGamma(this);
              };
            }).call(this);
          }).call(this, require2("_process"), require2("buffer").Buffer);
        }, { "./packer-async": 12, "./parser-async": 16, "./png-sync": 19, "_process": 63, "buffer": 32, "stream": 65, "util": 84 }], 21: [function(require2, module3, exports3) {
          (function(process, Buffer2) {
            (function() {
              "use strict";
              let assert = require2("assert").ok;
              let zlib = require2("zlib");
              let util = require2("util");
              let kMaxLength = require2("buffer").kMaxLength;
              function Inflate(opts) {
                if (!(this instanceof Inflate)) {
                  return new Inflate(opts);
                }
                if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
                  opts.chunkSize = zlib.Z_MIN_CHUNK;
                }
                zlib.Inflate.call(this, opts);
                this._offset = this._offset === void 0 ? this._outOffset : this._offset;
                this._buffer = this._buffer || this._outBuffer;
                if (opts && opts.maxLength != null) {
                  this._maxLength = opts.maxLength;
                }
              }
              function createInflate(opts) {
                return new Inflate(opts);
              }
              function _close(engine, callback) {
                if (callback) {
                  process.nextTick(callback);
                }
                if (!engine._handle) {
                  return;
                }
                engine._handle.close();
                engine._handle = null;
              }
              Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
                if (typeof asyncCb === "function") {
                  return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
                }
                let self2 = this;
                let availInBefore = chunk && chunk.length;
                let availOutBefore = this._chunkSize - this._offset;
                let leftToInflate = this._maxLength;
                let inOff = 0;
                let buffers = [];
                let nread = 0;
                let error;
                this.on("error", function(err) {
                  error = err;
                });
                function handleChunk(availInAfter, availOutAfter) {
                  if (self2._hadError) {
                    return;
                  }
                  let have = availOutBefore - availOutAfter;
                  assert(have >= 0, "have should not go down");
                  if (have > 0) {
                    let out = self2._buffer.slice(self2._offset, self2._offset + have);
                    self2._offset += have;
                    if (out.length > leftToInflate) {
                      out = out.slice(0, leftToInflate);
                    }
                    buffers.push(out);
                    nread += out.length;
                    leftToInflate -= out.length;
                    if (leftToInflate === 0) {
                      return false;
                    }
                  }
                  if (availOutAfter === 0 || self2._offset >= self2._chunkSize) {
                    availOutBefore = self2._chunkSize;
                    self2._offset = 0;
                    self2._buffer = Buffer2.allocUnsafe(self2._chunkSize);
                  }
                  if (availOutAfter === 0) {
                    inOff += availInBefore - availInAfter;
                    availInBefore = availInAfter;
                    return true;
                  }
                  return false;
                }
                assert(this._handle, "zlib binding closed");
                let res;
                do {
                  res = this._handle.writeSync(
                    flushFlag,
                    chunk,
                    // in
                    inOff,
                    // in_off
                    availInBefore,
                    // in_len
                    this._buffer,
                    // out
                    this._offset,
                    //out_off
                    availOutBefore
                  );
                  res = res || this._writeState;
                } while (!this._hadError && handleChunk(res[0], res[1]));
                if (this._hadError) {
                  throw error;
                }
                if (nread >= kMaxLength) {
                  _close(this);
                  throw new RangeError(
                    "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes"
                  );
                }
                let buf = Buffer2.concat(buffers, nread);
                _close(this);
                return buf;
              };
              util.inherits(Inflate, zlib.Inflate);
              function zlibBufferSync(engine, buffer) {
                if (typeof buffer === "string") {
                  buffer = Buffer2.from(buffer);
                }
                if (!(buffer instanceof Buffer2)) {
                  throw new TypeError("Not a string or buffer");
                }
                let flushFlag = engine._finishFlushFlag;
                if (flushFlag == null) {
                  flushFlag = zlib.Z_FINISH;
                }
                return engine._processChunk(buffer, flushFlag);
              }
              function inflateSync(buffer, opts) {
                return zlibBufferSync(new Inflate(opts), buffer);
              }
              module3.exports = exports3 = inflateSync;
              exports3.Inflate = Inflate;
              exports3.createInflate = createInflate;
              exports3.inflateSync = inflateSync;
            }).call(this);
          }).call(this, require2("_process"), require2("buffer").Buffer);
        }, { "_process": 63, "assert": 23, "buffer": 32, "util": 84, "zlib": 31 }], 22: [function(require2, module3, exports3) {
          "use strict";
          let SyncReader = module3.exports = function(buffer) {
            this._buffer = buffer;
            this._reads = [];
          };
          SyncReader.prototype.read = function(length, callback) {
            this._reads.push({
              length: Math.abs(length),
              // if length < 0 then at most this length
              allowLess: length < 0,
              func: callback
            });
          };
          SyncReader.prototype.process = function() {
            while (this._reads.length > 0 && this._buffer.length) {
              let read = this._reads[0];
              if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
                this._reads.shift();
                let buf = this._buffer;
                this._buffer = buf.slice(read.length);
                read.func.call(this, buf.slice(0, read.length));
              } else {
                break;
              }
            }
            if (this._reads.length > 0) {
              throw new Error("There are some read requests waitng on finished stream");
            }
            if (this._buffer.length > 0) {
              throw new Error("unrecognised content at end of stream");
            }
          };
        }, {}], 23: [function(require2, module3, exports3) {
          (function(global2) {
            (function() {
              "use strict";
              var objectAssign = require2("object-assign");
              function compare(a, b) {
                if (a === b) {
                  return 0;
                }
                var x = a.length;
                var y = b.length;
                for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                  if (a[i] !== b[i]) {
                    x = a[i];
                    y = b[i];
                    break;
                  }
                }
                if (x < y) {
                  return -1;
                }
                if (y < x) {
                  return 1;
                }
                return 0;
              }
              function isBuffer(b) {
                if (global2.Buffer && typeof global2.Buffer.isBuffer === "function") {
                  return global2.Buffer.isBuffer(b);
                }
                return !!(b != null && b._isBuffer);
              }
              var util = require2("util/");
              var hasOwn = Object.prototype.hasOwnProperty;
              var pSlice = Array.prototype.slice;
              var functionsHaveNames = function() {
                return function foo() {
                }.name === "foo";
              }();
              function pToString(obj) {
                return Object.prototype.toString.call(obj);
              }
              function isView(arrbuf) {
                if (isBuffer(arrbuf)) {
                  return false;
                }
                if (typeof global2.ArrayBuffer !== "function") {
                  return false;
                }
                if (typeof ArrayBuffer.isView === "function") {
                  return ArrayBuffer.isView(arrbuf);
                }
                if (!arrbuf) {
                  return false;
                }
                if (arrbuf instanceof DataView) {
                  return true;
                }
                if (arrbuf.buffer && arrbuf.buffer instanceof ArrayBuffer) {
                  return true;
                }
                return false;
              }
              var assert = module3.exports = ok;
              var regex = /\s*function\s+([^\(\s]*)\s*/;
              function getName(func) {
                if (!util.isFunction(func)) {
                  return;
                }
                if (functionsHaveNames) {
                  return func.name;
                }
                var str = func.toString();
                var match = str.match(regex);
                return match && match[1];
              }
              assert.AssertionError = function AssertionError(options) {
                this.name = "AssertionError";
                this.actual = options.actual;
                this.expected = options.expected;
                this.operator = options.operator;
                if (options.message) {
                  this.message = options.message;
                  this.generatedMessage = false;
                } else {
                  this.message = getMessage(this);
                  this.generatedMessage = true;
                }
                var stackStartFunction = options.stackStartFunction || fail;
                if (Error.captureStackTrace) {
                  Error.captureStackTrace(this, stackStartFunction);
                } else {
                  var err = new Error();
                  if (err.stack) {
                    var out = err.stack;
                    var fn_name = getName(stackStartFunction);
                    var idx = out.indexOf("\n" + fn_name);
                    if (idx >= 0) {
                      var next_line = out.indexOf("\n", idx + 1);
                      out = out.substring(next_line + 1);
                    }
                    this.stack = out;
                  }
                }
              };
              util.inherits(assert.AssertionError, Error);
              function truncate(s, n) {
                if (typeof s === "string") {
                  return s.length < n ? s : s.slice(0, n);
                } else {
                  return s;
                }
              }
              function inspect(something) {
                if (functionsHaveNames || !util.isFunction(something)) {
                  return util.inspect(something);
                }
                var rawname = getName(something);
                var name = rawname ? ": " + rawname : "";
                return "[Function" + name + "]";
              }
              function getMessage(self2) {
                return truncate(inspect(self2.actual), 128) + " " + self2.operator + " " + truncate(inspect(self2.expected), 128);
              }
              function fail(actual, expected, message, operator, stackStartFunction) {
                throw new assert.AssertionError({
                  message,
                  actual,
                  expected,
                  operator,
                  stackStartFunction
                });
              }
              assert.fail = fail;
              function ok(value, message) {
                if (!value) fail(value, true, message, "==", assert.ok);
              }
              assert.ok = ok;
              assert.equal = function equal(actual, expected, message) {
                if (actual != expected) fail(actual, expected, message, "==", assert.equal);
              };
              assert.notEqual = function notEqual(actual, expected, message) {
                if (actual == expected) {
                  fail(actual, expected, message, "!=", assert.notEqual);
                }
              };
              assert.deepEqual = function deepEqual(actual, expected, message) {
                if (!_deepEqual(actual, expected, false)) {
                  fail(actual, expected, message, "deepEqual", assert.deepEqual);
                }
              };
              assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
                if (!_deepEqual(actual, expected, true)) {
                  fail(actual, expected, message, "deepStrictEqual", assert.deepStrictEqual);
                }
              };
              function _deepEqual(actual, expected, strict2, memos) {
                if (actual === expected) {
                  return true;
                } else if (isBuffer(actual) && isBuffer(expected)) {
                  return compare(actual, expected) === 0;
                } else if (util.isDate(actual) && util.isDate(expected)) {
                  return actual.getTime() === expected.getTime();
                } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
                  return actual.source === expected.source && actual.global === expected.global && actual.multiline === expected.multiline && actual.lastIndex === expected.lastIndex && actual.ignoreCase === expected.ignoreCase;
                } else if ((actual === null || typeof actual !== "object") && (expected === null || typeof expected !== "object")) {
                  return strict2 ? actual === expected : actual == expected;
                } else if (isView(actual) && isView(expected) && pToString(actual) === pToString(expected) && !(actual instanceof Float32Array || actual instanceof Float64Array)) {
                  return compare(
                    new Uint8Array(actual.buffer),
                    new Uint8Array(expected.buffer)
                  ) === 0;
                } else if (isBuffer(actual) !== isBuffer(expected)) {
                  return false;
                } else {
                  memos = memos || { actual: [], expected: [] };
                  var actualIndex = memos.actual.indexOf(actual);
                  if (actualIndex !== -1) {
                    if (actualIndex === memos.expected.indexOf(expected)) {
                      return true;
                    }
                  }
                  memos.actual.push(actual);
                  memos.expected.push(expected);
                  return objEquiv(actual, expected, strict2, memos);
                }
              }
              function isArguments(object) {
                return Object.prototype.toString.call(object) == "[object Arguments]";
              }
              function objEquiv(a, b, strict2, actualVisitedObjects) {
                if (a === null || a === void 0 || b === null || b === void 0)
                  return false;
                if (util.isPrimitive(a) || util.isPrimitive(b))
                  return a === b;
                if (strict2 && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
                  return false;
                var aIsArgs = isArguments(a);
                var bIsArgs = isArguments(b);
                if (aIsArgs && !bIsArgs || !aIsArgs && bIsArgs)
                  return false;
                if (aIsArgs) {
                  a = pSlice.call(a);
                  b = pSlice.call(b);
                  return _deepEqual(a, b, strict2);
                }
                var ka = objectKeys(a);
                var kb = objectKeys(b);
                var key, i;
                if (ka.length !== kb.length)
                  return false;
                ka.sort();
                kb.sort();
                for (i = ka.length - 1; i >= 0; i--) {
                  if (ka[i] !== kb[i])
                    return false;
                }
                for (i = ka.length - 1; i >= 0; i--) {
                  key = ka[i];
                  if (!_deepEqual(a[key], b[key], strict2, actualVisitedObjects))
                    return false;
                }
                return true;
              }
              assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
                if (_deepEqual(actual, expected, false)) {
                  fail(actual, expected, message, "notDeepEqual", assert.notDeepEqual);
                }
              };
              assert.notDeepStrictEqual = notDeepStrictEqual;
              function notDeepStrictEqual(actual, expected, message) {
                if (_deepEqual(actual, expected, true)) {
                  fail(actual, expected, message, "notDeepStrictEqual", notDeepStrictEqual);
                }
              }
              assert.strictEqual = function strictEqual(actual, expected, message) {
                if (actual !== expected) {
                  fail(actual, expected, message, "===", assert.strictEqual);
                }
              };
              assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
                if (actual === expected) {
                  fail(actual, expected, message, "!==", assert.notStrictEqual);
                }
              };
              function expectedException(actual, expected) {
                if (!actual || !expected) {
                  return false;
                }
                if (Object.prototype.toString.call(expected) == "[object RegExp]") {
                  return expected.test(actual);
                }
                try {
                  if (actual instanceof expected) {
                    return true;
                  }
                } catch (e) {
                }
                if (Error.isPrototypeOf(expected)) {
                  return false;
                }
                return expected.call({}, actual) === true;
              }
              function _tryBlock(block) {
                var error;
                try {
                  block();
                } catch (e) {
                  error = e;
                }
                return error;
              }
              function _throws(shouldThrow, block, expected, message) {
                var actual;
                if (typeof block !== "function") {
                  throw new TypeError('"block" argument must be a function');
                }
                if (typeof expected === "string") {
                  message = expected;
                  expected = null;
                }
                actual = _tryBlock(block);
                message = (expected && expected.name ? " (" + expected.name + ")." : ".") + (message ? " " + message : ".");
                if (shouldThrow && !actual) {
                  fail(actual, expected, "Missing expected exception" + message);
                }
                var userProvidedMessage = typeof message === "string";
                var isUnwantedException = !shouldThrow && util.isError(actual);
                var isUnexpectedException = !shouldThrow && actual && !expected;
                if (isUnwantedException && userProvidedMessage && expectedException(actual, expected) || isUnexpectedException) {
                  fail(actual, expected, "Got unwanted exception" + message);
                }
                if (shouldThrow && actual && expected && !expectedException(actual, expected) || !shouldThrow && actual) {
                  throw actual;
                }
              }
              assert.throws = function(block, error, message) {
                _throws(true, block, error, message);
              };
              assert.doesNotThrow = function(block, error, message) {
                _throws(false, block, error, message);
              };
              assert.ifError = function(err) {
                if (err) throw err;
              };
              function strict(value, message) {
                if (!value) fail(value, true, message, "==", strict);
              }
              assert.strict = objectAssign(strict, assert, {
                equal: assert.strictEqual,
                deepEqual: assert.deepStrictEqual,
                notEqual: assert.notStrictEqual,
                notDeepEqual: assert.notDeepStrictEqual
              });
              assert.strict.strict = assert.strict;
              var objectKeys = Object.keys || function(obj) {
                var keys = [];
                for (var key in obj) {
                  if (hasOwn.call(obj, key)) keys.push(key);
                }
                return keys;
              };
            }).call(this);
          }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "object-assign": 51, "util/": 26 }], 24: [function(require2, module3, exports3) {
          if (typeof Object.create === "function") {
            module3.exports = function inherits(ctor, superCtor) {
              ctor.super_ = superCtor;
              ctor.prototype = Object.create(superCtor.prototype, {
                constructor: {
                  value: ctor,
                  enumerable: false,
                  writable: true,
                  configurable: true
                }
              });
            };
          } else {
            module3.exports = function inherits(ctor, superCtor) {
              ctor.super_ = superCtor;
              var TempCtor = function() {
              };
              TempCtor.prototype = superCtor.prototype;
              ctor.prototype = new TempCtor();
              ctor.prototype.constructor = ctor;
            };
          }
        }, {}], 25: [function(require2, module3, exports3) {
          module3.exports = function isBuffer(arg) {
            return arg && typeof arg === "object" && typeof arg.copy === "function" && typeof arg.fill === "function" && typeof arg.readUInt8 === "function";
          };
        }, {}], 26: [function(require2, module3, exports3) {
          (function(process, global2) {
            (function() {
              var formatRegExp = /%[sdj%]/g;
              exports3.format = function(f) {
                if (!isString(f)) {
                  var objects = [];
                  for (var i = 0; i < arguments.length; i++) {
                    objects.push(inspect(arguments[i]));
                  }
                  return objects.join(" ");
                }
                var i = 1;
                var args = arguments;
                var len = args.length;
                var str = String(f).replace(formatRegExp, function(x2) {
                  if (x2 === "%%") return "%";
                  if (i >= len) return x2;
                  switch (x2) {
                    case "%s":
                      return String(args[i++]);
                    case "%d":
                      return Number(args[i++]);
                    case "%j":
                      try {
                        return JSON.stringify(args[i++]);
                      } catch (_) {
                        return "[Circular]";
                      }
                    default:
                      return x2;
                  }
                });
                for (var x = args[i]; i < len; x = args[++i]) {
                  if (isNull(x) || !isObject(x)) {
                    str += " " + x;
                  } else {
                    str += " " + inspect(x);
                  }
                }
                return str;
              };
              exports3.deprecate = function(fn, msg) {
                if (isUndefined(global2.process)) {
                  return function() {
                    return exports3.deprecate(fn, msg).apply(this, arguments);
                  };
                }
                if (process.noDeprecation === true) {
                  return fn;
                }
                var warned = false;
                function deprecated() {
                  if (!warned) {
                    if (process.throwDeprecation) {
                      throw new Error(msg);
                    } else if (process.traceDeprecation) {
                      console.trace(msg);
                    } else {
                      console.error(msg);
                    }
                    warned = true;
                  }
                  return fn.apply(this, arguments);
                }
                return deprecated;
              };
              var debugs = {};
              var debugEnviron;
              exports3.debuglog = function(set) {
                if (isUndefined(debugEnviron))
                  debugEnviron = process.env.NODE_DEBUG || "";
                set = set.toUpperCase();
                if (!debugs[set]) {
                  if (new RegExp("\\b" + set + "\\b", "i").test(debugEnviron)) {
                    var pid = process.pid;
                    debugs[set] = function() {
                      var msg = exports3.format.apply(exports3, arguments);
                      console.error("%s %d: %s", set, pid, msg);
                    };
                  } else {
                    debugs[set] = function() {
                    };
                  }
                }
                return debugs[set];
              };
              function inspect(obj, opts) {
                var ctx2 = {
                  seen: [],
                  stylize: stylizeNoColor
                };
                if (arguments.length >= 3) ctx2.depth = arguments[2];
                if (arguments.length >= 4) ctx2.colors = arguments[3];
                if (isBoolean(opts)) {
                  ctx2.showHidden = opts;
                } else if (opts) {
                  exports3._extend(ctx2, opts);
                }
                if (isUndefined(ctx2.showHidden)) ctx2.showHidden = false;
                if (isUndefined(ctx2.depth)) ctx2.depth = 2;
                if (isUndefined(ctx2.colors)) ctx2.colors = false;
                if (isUndefined(ctx2.customInspect)) ctx2.customInspect = true;
                if (ctx2.colors) ctx2.stylize = stylizeWithColor;
                return formatValue(ctx2, obj, ctx2.depth);
              }
              exports3.inspect = inspect;
              inspect.colors = {
                "bold": [1, 22],
                "italic": [3, 23],
                "underline": [4, 24],
                "inverse": [7, 27],
                "white": [37, 39],
                "grey": [90, 39],
                "black": [30, 39],
                "blue": [34, 39],
                "cyan": [36, 39],
                "green": [32, 39],
                "magenta": [35, 39],
                "red": [31, 39],
                "yellow": [33, 39]
              };
              inspect.styles = {
                "special": "cyan",
                "number": "yellow",
                "boolean": "yellow",
                "undefined": "grey",
                "null": "bold",
                "string": "green",
                "date": "magenta",
                // "name": intentionally not styling
                "regexp": "red"
              };
              function stylizeWithColor(str, styleType) {
                var style = inspect.styles[styleType];
                if (style) {
                  return "\x1B[" + inspect.colors[style][0] + "m" + str + "\x1B[" + inspect.colors[style][1] + "m";
                } else {
                  return str;
                }
              }
              function stylizeNoColor(str, styleType) {
                return str;
              }
              function arrayToHash(array) {
                var hash = {};
                array.forEach(function(val2, idx) {
                  hash[val2] = true;
                });
                return hash;
              }
              function formatValue(ctx2, value, recurseTimes) {
                if (ctx2.customInspect && value && isFunction(value.inspect) && // Filter out the util module, it's inspect function is special
                value.inspect !== exports3.inspect && // Also filter out any prototype objects using the circular check.
                !(value.constructor && value.constructor.prototype === value)) {
                  var ret = value.inspect(recurseTimes, ctx2);
                  if (!isString(ret)) {
                    ret = formatValue(ctx2, ret, recurseTimes);
                  }
                  return ret;
                }
                var primitive = formatPrimitive(ctx2, value);
                if (primitive) {
                  return primitive;
                }
                var keys = Object.keys(value);
                var visibleKeys = arrayToHash(keys);
                if (ctx2.showHidden) {
                  keys = Object.getOwnPropertyNames(value);
                }
                if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
                  return formatError(value);
                }
                if (keys.length === 0) {
                  if (isFunction(value)) {
                    var name = value.name ? ": " + value.name : "";
                    return ctx2.stylize("[Function" + name + "]", "special");
                  }
                  if (isRegExp(value)) {
                    return ctx2.stylize(RegExp.prototype.toString.call(value), "regexp");
                  }
                  if (isDate(value)) {
                    return ctx2.stylize(Date.prototype.toString.call(value), "date");
                  }
                  if (isError(value)) {
                    return formatError(value);
                  }
                }
                var base = "", array = false, braces = ["{", "}"];
                if (isArray(value)) {
                  array = true;
                  braces = ["[", "]"];
                }
                if (isFunction(value)) {
                  var n = value.name ? ": " + value.name : "";
                  base = " [Function" + n + "]";
                }
                if (isRegExp(value)) {
                  base = " " + RegExp.prototype.toString.call(value);
                }
                if (isDate(value)) {
                  base = " " + Date.prototype.toUTCString.call(value);
                }
                if (isError(value)) {
                  base = " " + formatError(value);
                }
                if (keys.length === 0 && (!array || value.length == 0)) {
                  return braces[0] + base + braces[1];
                }
                if (recurseTimes < 0) {
                  if (isRegExp(value)) {
                    return ctx2.stylize(RegExp.prototype.toString.call(value), "regexp");
                  } else {
                    return ctx2.stylize("[Object]", "special");
                  }
                }
                ctx2.seen.push(value);
                var output;
                if (array) {
                  output = formatArray(ctx2, value, recurseTimes, visibleKeys, keys);
                } else {
                  output = keys.map(function(key) {
                    return formatProperty(ctx2, value, recurseTimes, visibleKeys, key, array);
                  });
                }
                ctx2.seen.pop();
                return reduceToSingleString(output, base, braces);
              }
              function formatPrimitive(ctx2, value) {
                if (isUndefined(value))
                  return ctx2.stylize("undefined", "undefined");
                if (isString(value)) {
                  var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
                  return ctx2.stylize(simple, "string");
                }
                if (isNumber(value))
                  return ctx2.stylize("" + value, "number");
                if (isBoolean(value))
                  return ctx2.stylize("" + value, "boolean");
                if (isNull(value))
                  return ctx2.stylize("null", "null");
              }
              function formatError(value) {
                return "[" + Error.prototype.toString.call(value) + "]";
              }
              function formatArray(ctx2, value, recurseTimes, visibleKeys, keys) {
                var output = [];
                for (var i = 0, l = value.length; i < l; ++i) {
                  if (hasOwnProperty(value, String(i))) {
                    output.push(formatProperty(
                      ctx2,
                      value,
                      recurseTimes,
                      visibleKeys,
                      String(i),
                      true
                    ));
                  } else {
                    output.push("");
                  }
                }
                keys.forEach(function(key) {
                  if (!key.match(/^\d+$/)) {
                    output.push(formatProperty(
                      ctx2,
                      value,
                      recurseTimes,
                      visibleKeys,
                      key,
                      true
                    ));
                  }
                });
                return output;
              }
              function formatProperty(ctx2, value, recurseTimes, visibleKeys, key, array) {
                var name, str, desc;
                desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
                if (desc.get) {
                  if (desc.set) {
                    str = ctx2.stylize("[Getter/Setter]", "special");
                  } else {
                    str = ctx2.stylize("[Getter]", "special");
                  }
                } else {
                  if (desc.set) {
                    str = ctx2.stylize("[Setter]", "special");
                  }
                }
                if (!hasOwnProperty(visibleKeys, key)) {
                  name = "[" + key + "]";
                }
                if (!str) {
                  if (ctx2.seen.indexOf(desc.value) < 0) {
                    if (isNull(recurseTimes)) {
                      str = formatValue(ctx2, desc.value, null);
                    } else {
                      str = formatValue(ctx2, desc.value, recurseTimes - 1);
                    }
                    if (str.indexOf("\n") > -1) {
                      if (array) {
                        str = str.split("\n").map(function(line) {
                          return "  " + line;
                        }).join("\n").substr(2);
                      } else {
                        str = "\n" + str.split("\n").map(function(line) {
                          return "   " + line;
                        }).join("\n");
                      }
                    }
                  } else {
                    str = ctx2.stylize("[Circular]", "special");
                  }
                }
                if (isUndefined(name)) {
                  if (array && key.match(/^\d+$/)) {
                    return str;
                  }
                  name = JSON.stringify("" + key);
                  if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
                    name = name.substr(1, name.length - 2);
                    name = ctx2.stylize(name, "name");
                  } else {
                    name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
                    name = ctx2.stylize(name, "string");
                  }
                }
                return name + ": " + str;
              }
              function reduceToSingleString(output, base, braces) {
                var numLinesEst = 0;
                var length = output.reduce(function(prev, cur) {
                  numLinesEst++;
                  if (cur.indexOf("\n") >= 0) numLinesEst++;
                  return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
                }, 0);
                if (length > 60) {
                  return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
                }
                return braces[0] + base + " " + output.join(", ") + " " + braces[1];
              }
              function isArray(ar) {
                return Array.isArray(ar);
              }
              exports3.isArray = isArray;
              function isBoolean(arg) {
                return typeof arg === "boolean";
              }
              exports3.isBoolean = isBoolean;
              function isNull(arg) {
                return arg === null;
              }
              exports3.isNull = isNull;
              function isNullOrUndefined(arg) {
                return arg == null;
              }
              exports3.isNullOrUndefined = isNullOrUndefined;
              function isNumber(arg) {
                return typeof arg === "number";
              }
              exports3.isNumber = isNumber;
              function isString(arg) {
                return typeof arg === "string";
              }
              exports3.isString = isString;
              function isSymbol(arg) {
                return typeof arg === "symbol";
              }
              exports3.isSymbol = isSymbol;
              function isUndefined(arg) {
                return arg === void 0;
              }
              exports3.isUndefined = isUndefined;
              function isRegExp(re) {
                return isObject(re) && objectToString(re) === "[object RegExp]";
              }
              exports3.isRegExp = isRegExp;
              function isObject(arg) {
                return typeof arg === "object" && arg !== null;
              }
              exports3.isObject = isObject;
              function isDate(d) {
                return isObject(d) && objectToString(d) === "[object Date]";
              }
              exports3.isDate = isDate;
              function isError(e) {
                return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error);
              }
              exports3.isError = isError;
              function isFunction(arg) {
                return typeof arg === "function";
              }
              exports3.isFunction = isFunction;
              function isPrimitive(arg) {
                return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || // ES6 symbol
                typeof arg === "undefined";
              }
              exports3.isPrimitive = isPrimitive;
              exports3.isBuffer = require2("./support/isBuffer");
              function objectToString(o) {
                return Object.prototype.toString.call(o);
              }
              function pad(n) {
                return n < 10 ? "0" + n.toString(10) : n.toString(10);
              }
              var months = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec"
              ];
              function timestamp() {
                var d = /* @__PURE__ */ new Date();
                var time = [
                  pad(d.getHours()),
                  pad(d.getMinutes()),
                  pad(d.getSeconds())
                ].join(":");
                return [d.getDate(), months[d.getMonth()], time].join(" ");
              }
              exports3.log = function() {
                console.log("%s - %s", timestamp(), exports3.format.apply(exports3, arguments));
              };
              exports3.inherits = require2("inherits");
              exports3._extend = function(origin, add) {
                if (!add || !isObject(add)) return origin;
                var keys = Object.keys(add);
                var i = keys.length;
                while (i--) {
                  origin[keys[i]] = add[keys[i]];
                }
                return origin;
              };
              function hasOwnProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop);
              }
            }).call(this);
          }).call(this, require2("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "./support/isBuffer": 25, "_process": 63, "inherits": 24 }], 27: [function(require2, module3, exports3) {
          (function(global2) {
            (function() {
              "use strict";
              var possibleNames = [
                "BigInt64Array",
                "BigUint64Array",
                "Float32Array",
                "Float64Array",
                "Int16Array",
                "Int32Array",
                "Int8Array",
                "Uint16Array",
                "Uint32Array",
                "Uint8Array",
                "Uint8ClampedArray"
              ];
              var g = typeof globalThis === "undefined" ? global2 : globalThis;
              module3.exports = function availableTypedArrays() {
                var out = [];
                for (var i = 0; i < possibleNames.length; i++) {
                  if (typeof g[possibleNames[i]] === "function") {
                    out[out.length] = possibleNames[i];
                  }
                }
                return out;
              };
            }).call(this);
          }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {}], 28: [function(require2, module3, exports3) {
          "use strict";
          exports3.byteLength = byteLength;
          exports3.toByteArray = toByteArray;
          exports3.fromByteArray = fromByteArray;
          var lookup = [];
          var revLookup = [];
          var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
          var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
          for (var i = 0, len = code.length; i < len; ++i) {
            lookup[i] = code[i];
            revLookup[code.charCodeAt(i)] = i;
          }
          revLookup["-".charCodeAt(0)] = 62;
          revLookup["_".charCodeAt(0)] = 63;
          function getLens(b64) {
            var len2 = b64.length;
            if (len2 % 4 > 0) {
              throw new Error("Invalid string. Length must be a multiple of 4");
            }
            var validLen = b64.indexOf("=");
            if (validLen === -1) validLen = len2;
            var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
            return [validLen, placeHoldersLen];
          }
          function byteLength(b64) {
            var lens = getLens(b64);
            var validLen = lens[0];
            var placeHoldersLen = lens[1];
            return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
          }
          function _byteLength(b64, validLen, placeHoldersLen) {
            return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
          }
          function toByteArray(b64) {
            var tmp;
            var lens = getLens(b64);
            var validLen = lens[0];
            var placeHoldersLen = lens[1];
            var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
            var curByte = 0;
            var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
            var i2;
            for (i2 = 0; i2 < len2; i2 += 4) {
              tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
              arr[curByte++] = tmp >> 16 & 255;
              arr[curByte++] = tmp >> 8 & 255;
              arr[curByte++] = tmp & 255;
            }
            if (placeHoldersLen === 2) {
              tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
              arr[curByte++] = tmp & 255;
            }
            if (placeHoldersLen === 1) {
              tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
              arr[curByte++] = tmp >> 8 & 255;
              arr[curByte++] = tmp & 255;
            }
            return arr;
          }
          function tripletToBase64(num) {
            return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
          }
          function encodeChunk(uint8, start, end) {
            var tmp;
            var output = [];
            for (var i2 = start; i2 < end; i2 += 3) {
              tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
              output.push(tripletToBase64(tmp));
            }
            return output.join("");
          }
          function fromByteArray(uint8) {
            var tmp;
            var len2 = uint8.length;
            var extraBytes = len2 % 3;
            var parts = [];
            var maxChunkLength = 16383;
            for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
              parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
            }
            if (extraBytes === 1) {
              tmp = uint8[len2 - 1];
              parts.push(
                lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
              );
            } else if (extraBytes === 2) {
              tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
              parts.push(
                lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
              );
            }
            return parts.join("");
          }
        }, {}], 29: [function(require2, module3, exports3) {
        }, {}], 30: [function(require2, module3, exports3) {
          (function(process, Buffer2) {
            (function() {
              "use strict";
              var assert = require2("assert");
              var Zstream = require2("pako/lib/zlib/zstream");
              var zlib_deflate = require2("pako/lib/zlib/deflate.js");
              var zlib_inflate = require2("pako/lib/zlib/inflate.js");
              var constants = require2("pako/lib/zlib/constants");
              for (var key in constants) {
                exports3[key] = constants[key];
              }
              exports3.NONE = 0;
              exports3.DEFLATE = 1;
              exports3.INFLATE = 2;
              exports3.GZIP = 3;
              exports3.GUNZIP = 4;
              exports3.DEFLATERAW = 5;
              exports3.INFLATERAW = 6;
              exports3.UNZIP = 7;
              var GZIP_HEADER_ID1 = 31;
              var GZIP_HEADER_ID2 = 139;
              function Zlib(mode) {
                if (typeof mode !== "number" || mode < exports3.DEFLATE || mode > exports3.UNZIP) {
                  throw new TypeError("Bad argument");
                }
                this.dictionary = null;
                this.err = 0;
                this.flush = 0;
                this.init_done = false;
                this.level = 0;
                this.memLevel = 0;
                this.mode = mode;
                this.strategy = 0;
                this.windowBits = 0;
                this.write_in_progress = false;
                this.pending_close = false;
                this.gzip_id_bytes_read = 0;
              }
              Zlib.prototype.close = function() {
                if (this.write_in_progress) {
                  this.pending_close = true;
                  return;
                }
                this.pending_close = false;
                assert(this.init_done, "close before init");
                assert(this.mode <= exports3.UNZIP);
                if (this.mode === exports3.DEFLATE || this.mode === exports3.GZIP || this.mode === exports3.DEFLATERAW) {
                  zlib_deflate.deflateEnd(this.strm);
                } else if (this.mode === exports3.INFLATE || this.mode === exports3.GUNZIP || this.mode === exports3.INFLATERAW || this.mode === exports3.UNZIP) {
                  zlib_inflate.inflateEnd(this.strm);
                }
                this.mode = exports3.NONE;
                this.dictionary = null;
              };
              Zlib.prototype.write = function(flush, input, in_off, in_len, out, out_off, out_len) {
                return this._write(true, flush, input, in_off, in_len, out, out_off, out_len);
              };
              Zlib.prototype.writeSync = function(flush, input, in_off, in_len, out, out_off, out_len) {
                return this._write(false, flush, input, in_off, in_len, out, out_off, out_len);
              };
              Zlib.prototype._write = function(async, flush, input, in_off, in_len, out, out_off, out_len) {
                assert.equal(arguments.length, 8);
                assert(this.init_done, "write before init");
                assert(this.mode !== exports3.NONE, "already finalized");
                assert.equal(false, this.write_in_progress, "write already in progress");
                assert.equal(false, this.pending_close, "close is pending");
                this.write_in_progress = true;
                assert.equal(false, flush === void 0, "must provide flush value");
                this.write_in_progress = true;
                if (flush !== exports3.Z_NO_FLUSH && flush !== exports3.Z_PARTIAL_FLUSH && flush !== exports3.Z_SYNC_FLUSH && flush !== exports3.Z_FULL_FLUSH && flush !== exports3.Z_FINISH && flush !== exports3.Z_BLOCK) {
                  throw new Error("Invalid flush value");
                }
                if (input == null) {
                  input = Buffer2.alloc(0);
                  in_len = 0;
                  in_off = 0;
                }
                this.strm.avail_in = in_len;
                this.strm.input = input;
                this.strm.next_in = in_off;
                this.strm.avail_out = out_len;
                this.strm.output = out;
                this.strm.next_out = out_off;
                this.flush = flush;
                if (!async) {
                  this._process();
                  if (this._checkError()) {
                    return this._afterSync();
                  }
                  return;
                }
                var self2 = this;
                process.nextTick(function() {
                  self2._process();
                  self2._after();
                });
                return this;
              };
              Zlib.prototype._afterSync = function() {
                var avail_out = this.strm.avail_out;
                var avail_in = this.strm.avail_in;
                this.write_in_progress = false;
                return [avail_in, avail_out];
              };
              Zlib.prototype._process = function() {
                var next_expected_header_byte = null;
                switch (this.mode) {
                  case exports3.DEFLATE:
                  case exports3.GZIP:
                  case exports3.DEFLATERAW:
                    this.err = zlib_deflate.deflate(this.strm, this.flush);
                    break;
                  case exports3.UNZIP:
                    if (this.strm.avail_in > 0) {
                      next_expected_header_byte = this.strm.next_in;
                    }
                    switch (this.gzip_id_bytes_read) {
                      case 0:
                        if (next_expected_header_byte === null) {
                          break;
                        }
                        if (this.strm.input[next_expected_header_byte] === GZIP_HEADER_ID1) {
                          this.gzip_id_bytes_read = 1;
                          next_expected_header_byte++;
                          if (this.strm.avail_in === 1) {
                            break;
                          }
                        } else {
                          this.mode = exports3.INFLATE;
                          break;
                        }
                      case 1:
                        if (next_expected_header_byte === null) {
                          break;
                        }
                        if (this.strm.input[next_expected_header_byte] === GZIP_HEADER_ID2) {
                          this.gzip_id_bytes_read = 2;
                          this.mode = exports3.GUNZIP;
                        } else {
                          this.mode = exports3.INFLATE;
                        }
                        break;
                      default:
                        throw new Error("invalid number of gzip magic number bytes read");
                    }
                  case exports3.INFLATE:
                  case exports3.GUNZIP:
                  case exports3.INFLATERAW:
                    this.err = zlib_inflate.inflate(
                      this.strm,
                      this.flush
                      // If data was encoded with dictionary
                    );
                    if (this.err === exports3.Z_NEED_DICT && this.dictionary) {
                      this.err = zlib_inflate.inflateSetDictionary(this.strm, this.dictionary);
                      if (this.err === exports3.Z_OK) {
                        this.err = zlib_inflate.inflate(this.strm, this.flush);
                      } else if (this.err === exports3.Z_DATA_ERROR) {
                        this.err = exports3.Z_NEED_DICT;
                      }
                    }
                    while (this.strm.avail_in > 0 && this.mode === exports3.GUNZIP && this.err === exports3.Z_STREAM_END && this.strm.next_in[0] !== 0) {
                      this.reset();
                      this.err = zlib_inflate.inflate(this.strm, this.flush);
                    }
                    break;
                  default:
                    throw new Error("Unknown mode " + this.mode);
                }
              };
              Zlib.prototype._checkError = function() {
                switch (this.err) {
                  case exports3.Z_OK:
                  case exports3.Z_BUF_ERROR:
                    if (this.strm.avail_out !== 0 && this.flush === exports3.Z_FINISH) {
                      this._error("unexpected end of file");
                      return false;
                    }
                    break;
                  case exports3.Z_STREAM_END:
                    break;
                  case exports3.Z_NEED_DICT:
                    if (this.dictionary == null) {
                      this._error("Missing dictionary");
                    } else {
                      this._error("Bad dictionary");
                    }
                    return false;
                  default:
                    this._error("Zlib error");
                    return false;
                }
                return true;
              };
              Zlib.prototype._after = function() {
                if (!this._checkError()) {
                  return;
                }
                var avail_out = this.strm.avail_out;
                var avail_in = this.strm.avail_in;
                this.write_in_progress = false;
                this.callback(avail_in, avail_out);
                if (this.pending_close) {
                  this.close();
                }
              };
              Zlib.prototype._error = function(message) {
                if (this.strm.msg) {
                  message = this.strm.msg;
                }
                this.onerror(
                  message,
                  this.err
                  // no hope of rescue.
                );
                this.write_in_progress = false;
                if (this.pending_close) {
                  this.close();
                }
              };
              Zlib.prototype.init = function(windowBits, level, memLevel, strategy, dictionary) {
                assert(arguments.length === 4 || arguments.length === 5, "init(windowBits, level, memLevel, strategy, [dictionary])");
                assert(windowBits >= 8 && windowBits <= 15, "invalid windowBits");
                assert(level >= -1 && level <= 9, "invalid compression level");
                assert(memLevel >= 1 && memLevel <= 9, "invalid memlevel");
                assert(strategy === exports3.Z_FILTERED || strategy === exports3.Z_HUFFMAN_ONLY || strategy === exports3.Z_RLE || strategy === exports3.Z_FIXED || strategy === exports3.Z_DEFAULT_STRATEGY, "invalid strategy");
                this._init(level, windowBits, memLevel, strategy, dictionary);
                this._setDictionary();
              };
              Zlib.prototype.params = function() {
                throw new Error("deflateParams Not supported");
              };
              Zlib.prototype.reset = function() {
                this._reset();
                this._setDictionary();
              };
              Zlib.prototype._init = function(level, windowBits, memLevel, strategy, dictionary) {
                this.level = level;
                this.windowBits = windowBits;
                this.memLevel = memLevel;
                this.strategy = strategy;
                this.flush = exports3.Z_NO_FLUSH;
                this.err = exports3.Z_OK;
                if (this.mode === exports3.GZIP || this.mode === exports3.GUNZIP) {
                  this.windowBits += 16;
                }
                if (this.mode === exports3.UNZIP) {
                  this.windowBits += 32;
                }
                if (this.mode === exports3.DEFLATERAW || this.mode === exports3.INFLATERAW) {
                  this.windowBits = -1 * this.windowBits;
                }
                this.strm = new Zstream();
                switch (this.mode) {
                  case exports3.DEFLATE:
                  case exports3.GZIP:
                  case exports3.DEFLATERAW:
                    this.err = zlib_deflate.deflateInit2(this.strm, this.level, exports3.Z_DEFLATED, this.windowBits, this.memLevel, this.strategy);
                    break;
                  case exports3.INFLATE:
                  case exports3.GUNZIP:
                  case exports3.INFLATERAW:
                  case exports3.UNZIP:
                    this.err = zlib_inflate.inflateInit2(this.strm, this.windowBits);
                    break;
                  default:
                    throw new Error("Unknown mode " + this.mode);
                }
                if (this.err !== exports3.Z_OK) {
                  this._error("Init error");
                }
                this.dictionary = dictionary;
                this.write_in_progress = false;
                this.init_done = true;
              };
              Zlib.prototype._setDictionary = function() {
                if (this.dictionary == null) {
                  return;
                }
                this.err = exports3.Z_OK;
                switch (this.mode) {
                  case exports3.DEFLATE:
                  case exports3.DEFLATERAW:
                    this.err = zlib_deflate.deflateSetDictionary(this.strm, this.dictionary);
                    break;
                  default:
                    break;
                }
                if (this.err !== exports3.Z_OK) {
                  this._error("Failed to set dictionary");
                }
              };
              Zlib.prototype._reset = function() {
                this.err = exports3.Z_OK;
                switch (this.mode) {
                  case exports3.DEFLATE:
                  case exports3.DEFLATERAW:
                  case exports3.GZIP:
                    this.err = zlib_deflate.deflateReset(this.strm);
                    break;
                  case exports3.INFLATE:
                  case exports3.INFLATERAW:
                  case exports3.GUNZIP:
                    this.err = zlib_inflate.inflateReset(this.strm);
                    break;
                  default:
                    break;
                }
                if (this.err !== exports3.Z_OK) {
                  this._error("Failed to reset stream");
                }
              };
              exports3.Zlib = Zlib;
            }).call(this);
          }).call(this, require2("_process"), require2("buffer").Buffer);
        }, { "_process": 63, "assert": 23, "buffer": 32, "pako/lib/zlib/constants": 54, "pako/lib/zlib/deflate.js": 56, "pako/lib/zlib/inflate.js": 58, "pako/lib/zlib/zstream": 62 }], 31: [function(require2, module3, exports3) {
          (function(process) {
            (function() {
              "use strict";
              var Buffer2 = require2("buffer").Buffer;
              var Transform = require2("stream").Transform;
              var binding = require2("./binding");
              var util = require2("util");
              var assert = require2("assert").ok;
              var kMaxLength = require2("buffer").kMaxLength;
              var kRangeErrorMessage = "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes";
              binding.Z_MIN_WINDOWBITS = 8;
              binding.Z_MAX_WINDOWBITS = 15;
              binding.Z_DEFAULT_WINDOWBITS = 15;
              binding.Z_MIN_CHUNK = 64;
              binding.Z_MAX_CHUNK = Infinity;
              binding.Z_DEFAULT_CHUNK = 16 * 1024;
              binding.Z_MIN_MEMLEVEL = 1;
              binding.Z_MAX_MEMLEVEL = 9;
              binding.Z_DEFAULT_MEMLEVEL = 8;
              binding.Z_MIN_LEVEL = -1;
              binding.Z_MAX_LEVEL = 9;
              binding.Z_DEFAULT_LEVEL = binding.Z_DEFAULT_COMPRESSION;
              var bkeys = Object.keys(binding);
              for (var bk = 0; bk < bkeys.length; bk++) {
                var bkey = bkeys[bk];
                if (bkey.match(/^Z/)) {
                  Object.defineProperty(exports3, bkey, {
                    enumerable: true,
                    value: binding[bkey],
                    writable: false
                  });
                }
              }
              var codes = {
                Z_OK: binding.Z_OK,
                Z_STREAM_END: binding.Z_STREAM_END,
                Z_NEED_DICT: binding.Z_NEED_DICT,
                Z_ERRNO: binding.Z_ERRNO,
                Z_STREAM_ERROR: binding.Z_STREAM_ERROR,
                Z_DATA_ERROR: binding.Z_DATA_ERROR,
                Z_MEM_ERROR: binding.Z_MEM_ERROR,
                Z_BUF_ERROR: binding.Z_BUF_ERROR,
                Z_VERSION_ERROR: binding.Z_VERSION_ERROR
              };
              var ckeys = Object.keys(codes);
              for (var ck = 0; ck < ckeys.length; ck++) {
                var ckey = ckeys[ck];
                codes[codes[ckey]] = ckey;
              }
              Object.defineProperty(exports3, "codes", {
                enumerable: true,
                value: Object.freeze(codes),
                writable: false
              });
              exports3.Deflate = Deflate;
              exports3.Inflate = Inflate;
              exports3.Gzip = Gzip;
              exports3.Gunzip = Gunzip;
              exports3.DeflateRaw = DeflateRaw;
              exports3.InflateRaw = InflateRaw;
              exports3.Unzip = Unzip;
              exports3.createDeflate = function(o) {
                return new Deflate(o);
              };
              exports3.createInflate = function(o) {
                return new Inflate(o);
              };
              exports3.createDeflateRaw = function(o) {
                return new DeflateRaw(o);
              };
              exports3.createInflateRaw = function(o) {
                return new InflateRaw(o);
              };
              exports3.createGzip = function(o) {
                return new Gzip(o);
              };
              exports3.createGunzip = function(o) {
                return new Gunzip(o);
              };
              exports3.createUnzip = function(o) {
                return new Unzip(o);
              };
              exports3.deflate = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new Deflate(opts), buffer, callback);
              };
              exports3.deflateSync = function(buffer, opts) {
                return zlibBufferSync(new Deflate(opts), buffer);
              };
              exports3.gzip = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new Gzip(opts), buffer, callback);
              };
              exports3.gzipSync = function(buffer, opts) {
                return zlibBufferSync(new Gzip(opts), buffer);
              };
              exports3.deflateRaw = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new DeflateRaw(opts), buffer, callback);
              };
              exports3.deflateRawSync = function(buffer, opts) {
                return zlibBufferSync(new DeflateRaw(opts), buffer);
              };
              exports3.unzip = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new Unzip(opts), buffer, callback);
              };
              exports3.unzipSync = function(buffer, opts) {
                return zlibBufferSync(new Unzip(opts), buffer);
              };
              exports3.inflate = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new Inflate(opts), buffer, callback);
              };
              exports3.inflateSync = function(buffer, opts) {
                return zlibBufferSync(new Inflate(opts), buffer);
              };
              exports3.gunzip = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new Gunzip(opts), buffer, callback);
              };
              exports3.gunzipSync = function(buffer, opts) {
                return zlibBufferSync(new Gunzip(opts), buffer);
              };
              exports3.inflateRaw = function(buffer, opts, callback) {
                if (typeof opts === "function") {
                  callback = opts;
                  opts = {};
                }
                return zlibBuffer(new InflateRaw(opts), buffer, callback);
              };
              exports3.inflateRawSync = function(buffer, opts) {
                return zlibBufferSync(new InflateRaw(opts), buffer);
              };
              function zlibBuffer(engine, buffer, callback) {
                var buffers = [];
                var nread = 0;
                engine.on("error", onError);
                engine.on("end", onEnd);
                engine.end(buffer);
                flow();
                function flow() {
                  var chunk;
                  while (null !== (chunk = engine.read())) {
                    buffers.push(chunk);
                    nread += chunk.length;
                  }
                  engine.once("readable", flow);
                }
                function onError(err) {
                  engine.removeListener("end", onEnd);
                  engine.removeListener("readable", flow);
                  callback(err);
                }
                function onEnd() {
                  var buf;
                  var err = null;
                  if (nread >= kMaxLength) {
                    err = new RangeError(kRangeErrorMessage);
                  } else {
                    buf = Buffer2.concat(buffers, nread);
                  }
                  buffers = [];
                  engine.close();
                  callback(err, buf);
                }
              }
              function zlibBufferSync(engine, buffer) {
                if (typeof buffer === "string") buffer = Buffer2.from(buffer);
                if (!Buffer2.isBuffer(buffer)) throw new TypeError("Not a string or buffer");
                var flushFlag = engine._finishFlushFlag;
                return engine._processChunk(buffer, flushFlag);
              }
              function Deflate(opts) {
                if (!(this instanceof Deflate)) return new Deflate(opts);
                Zlib.call(this, opts, binding.DEFLATE);
              }
              function Inflate(opts) {
                if (!(this instanceof Inflate)) return new Inflate(opts);
                Zlib.call(this, opts, binding.INFLATE);
              }
              function Gzip(opts) {
                if (!(this instanceof Gzip)) return new Gzip(opts);
                Zlib.call(this, opts, binding.GZIP);
              }
              function Gunzip(opts) {
                if (!(this instanceof Gunzip)) return new Gunzip(opts);
                Zlib.call(this, opts, binding.GUNZIP);
              }
              function DeflateRaw(opts) {
                if (!(this instanceof DeflateRaw)) return new DeflateRaw(opts);
                Zlib.call(this, opts, binding.DEFLATERAW);
              }
              function InflateRaw(opts) {
                if (!(this instanceof InflateRaw)) return new InflateRaw(opts);
                Zlib.call(this, opts, binding.INFLATERAW);
              }
              function Unzip(opts) {
                if (!(this instanceof Unzip)) return new Unzip(opts);
                Zlib.call(this, opts, binding.UNZIP);
              }
              function isValidFlushFlag(flag) {
                return flag === binding.Z_NO_FLUSH || flag === binding.Z_PARTIAL_FLUSH || flag === binding.Z_SYNC_FLUSH || flag === binding.Z_FULL_FLUSH || flag === binding.Z_FINISH || flag === binding.Z_BLOCK;
              }
              function Zlib(opts, mode) {
                var _this = this;
                this._opts = opts = opts || {};
                this._chunkSize = opts.chunkSize || exports3.Z_DEFAULT_CHUNK;
                Transform.call(this, opts);
                if (opts.flush && !isValidFlushFlag(opts.flush)) {
                  throw new Error("Invalid flush flag: " + opts.flush);
                }
                if (opts.finishFlush && !isValidFlushFlag(opts.finishFlush)) {
                  throw new Error("Invalid flush flag: " + opts.finishFlush);
                }
                this._flushFlag = opts.flush || binding.Z_NO_FLUSH;
                this._finishFlushFlag = typeof opts.finishFlush !== "undefined" ? opts.finishFlush : binding.Z_FINISH;
                if (opts.chunkSize) {
                  if (opts.chunkSize < exports3.Z_MIN_CHUNK || opts.chunkSize > exports3.Z_MAX_CHUNK) {
                    throw new Error("Invalid chunk size: " + opts.chunkSize);
                  }
                }
                if (opts.windowBits) {
                  if (opts.windowBits < exports3.Z_MIN_WINDOWBITS || opts.windowBits > exports3.Z_MAX_WINDOWBITS) {
                    throw new Error("Invalid windowBits: " + opts.windowBits);
                  }
                }
                if (opts.level) {
                  if (opts.level < exports3.Z_MIN_LEVEL || opts.level > exports3.Z_MAX_LEVEL) {
                    throw new Error("Invalid compression level: " + opts.level);
                  }
                }
                if (opts.memLevel) {
                  if (opts.memLevel < exports3.Z_MIN_MEMLEVEL || opts.memLevel > exports3.Z_MAX_MEMLEVEL) {
                    throw new Error("Invalid memLevel: " + opts.memLevel);
                  }
                }
                if (opts.strategy) {
                  if (opts.strategy != exports3.Z_FILTERED && opts.strategy != exports3.Z_HUFFMAN_ONLY && opts.strategy != exports3.Z_RLE && opts.strategy != exports3.Z_FIXED && opts.strategy != exports3.Z_DEFAULT_STRATEGY) {
                    throw new Error("Invalid strategy: " + opts.strategy);
                  }
                }
                if (opts.dictionary) {
                  if (!Buffer2.isBuffer(opts.dictionary)) {
                    throw new Error("Invalid dictionary: it should be a Buffer instance");
                  }
                }
                this._handle = new binding.Zlib(mode);
                var self2 = this;
                this._hadError = false;
                this._handle.onerror = function(message, errno) {
                  _close(self2);
                  self2._hadError = true;
                  var error = new Error(message);
                  error.errno = errno;
                  error.code = exports3.codes[errno];
                  self2.emit("error", error);
                };
                var level = exports3.Z_DEFAULT_COMPRESSION;
                if (typeof opts.level === "number") level = opts.level;
                var strategy = exports3.Z_DEFAULT_STRATEGY;
                if (typeof opts.strategy === "number") strategy = opts.strategy;
                this._handle.init(opts.windowBits || exports3.Z_DEFAULT_WINDOWBITS, level, opts.memLevel || exports3.Z_DEFAULT_MEMLEVEL, strategy, opts.dictionary);
                this._buffer = Buffer2.allocUnsafe(this._chunkSize);
                this._offset = 0;
                this._level = level;
                this._strategy = strategy;
                this.once("end", this.close);
                Object.defineProperty(this, "_closed", {
                  get: function() {
                    return !_this._handle;
                  },
                  configurable: true,
                  enumerable: true
                });
              }
              util.inherits(Zlib, Transform);
              Zlib.prototype.params = function(level, strategy, callback) {
                if (level < exports3.Z_MIN_LEVEL || level > exports3.Z_MAX_LEVEL) {
                  throw new RangeError("Invalid compression level: " + level);
                }
                if (strategy != exports3.Z_FILTERED && strategy != exports3.Z_HUFFMAN_ONLY && strategy != exports3.Z_RLE && strategy != exports3.Z_FIXED && strategy != exports3.Z_DEFAULT_STRATEGY) {
                  throw new TypeError("Invalid strategy: " + strategy);
                }
                if (this._level !== level || this._strategy !== strategy) {
                  var self2 = this;
                  this.flush(binding.Z_SYNC_FLUSH, function() {
                    assert(self2._handle, "zlib binding closed");
                    self2._handle.params(level, strategy);
                    if (!self2._hadError) {
                      self2._level = level;
                      self2._strategy = strategy;
                      if (callback) callback();
                    }
                  });
                } else {
                  process.nextTick(callback);
                }
              };
              Zlib.prototype.reset = function() {
                assert(this._handle, "zlib binding closed");
                return this._handle.reset();
              };
              Zlib.prototype._flush = function(callback) {
                this._transform(Buffer2.alloc(0), "", callback);
              };
              Zlib.prototype.flush = function(kind, callback) {
                var _this2 = this;
                var ws = this._writableState;
                if (typeof kind === "function" || kind === void 0 && !callback) {
                  callback = kind;
                  kind = binding.Z_FULL_FLUSH;
                }
                if (ws.ended) {
                  if (callback) process.nextTick(callback);
                } else if (ws.ending) {
                  if (callback) this.once("end", callback);
                } else if (ws.needDrain) {
                  if (callback) {
                    this.once("drain", function() {
                      return _this2.flush(kind, callback);
                    });
                  }
                } else {
                  this._flushFlag = kind;
                  this.write(Buffer2.alloc(0), "", callback);
                }
              };
              Zlib.prototype.close = function(callback) {
                _close(this, callback);
                process.nextTick(emitCloseNT, this);
              };
              function _close(engine, callback) {
                if (callback) process.nextTick(callback);
                if (!engine._handle) return;
                engine._handle.close();
                engine._handle = null;
              }
              function emitCloseNT(self2) {
                self2.emit("close");
              }
              Zlib.prototype._transform = function(chunk, encoding, cb) {
                var flushFlag;
                var ws = this._writableState;
                var ending = ws.ending || ws.ended;
                var last = ending && (!chunk || ws.length === chunk.length);
                if (chunk !== null && !Buffer2.isBuffer(chunk)) return cb(new Error("invalid input"));
                if (!this._handle) return cb(new Error("zlib binding closed"));
                if (last) flushFlag = this._finishFlushFlag;
                else {
                  flushFlag = this._flushFlag;
                  if (chunk.length >= ws.length) {
                    this._flushFlag = this._opts.flush || binding.Z_NO_FLUSH;
                  }
                }
                this._processChunk(chunk, flushFlag, cb);
              };
              Zlib.prototype._processChunk = function(chunk, flushFlag, cb) {
                var availInBefore = chunk && chunk.length;
                var availOutBefore = this._chunkSize - this._offset;
                var inOff = 0;
                var self2 = this;
                var async = typeof cb === "function";
                if (!async) {
                  var buffers = [];
                  var nread = 0;
                  var error;
                  this.on("error", function(er) {
                    error = er;
                  });
                  assert(this._handle, "zlib binding closed");
                  do {
                    var res = this._handle.writeSync(
                      flushFlag,
                      chunk,
                      // in
                      inOff,
                      // in_off
                      availInBefore,
                      // in_len
                      this._buffer,
                      // out
                      this._offset,
                      //out_off
                      availOutBefore
                    );
                  } while (!this._hadError && callback(res[0], res[1]));
                  if (this._hadError) {
                    throw error;
                  }
                  if (nread >= kMaxLength) {
                    _close(this);
                    throw new RangeError(kRangeErrorMessage);
                  }
                  var buf = Buffer2.concat(buffers, nread);
                  _close(this);
                  return buf;
                }
                assert(this._handle, "zlib binding closed");
                var req = this._handle.write(
                  flushFlag,
                  chunk,
                  // in
                  inOff,
                  // in_off
                  availInBefore,
                  // in_len
                  this._buffer,
                  // out
                  this._offset,
                  //out_off
                  availOutBefore
                );
                req.buffer = chunk;
                req.callback = callback;
                function callback(availInAfter, availOutAfter) {
                  if (this) {
                    this.buffer = null;
                    this.callback = null;
                  }
                  if (self2._hadError) return;
                  var have = availOutBefore - availOutAfter;
                  assert(have >= 0, "have should not go down");
                  if (have > 0) {
                    var out = self2._buffer.slice(self2._offset, self2._offset + have);
                    self2._offset += have;
                    if (async) {
                      self2.push(out);
                    } else {
                      buffers.push(out);
                      nread += out.length;
                    }
                  }
                  if (availOutAfter === 0 || self2._offset >= self2._chunkSize) {
                    availOutBefore = self2._chunkSize;
                    self2._offset = 0;
                    self2._buffer = Buffer2.allocUnsafe(self2._chunkSize);
                  }
                  if (availOutAfter === 0) {
                    inOff += availInBefore - availInAfter;
                    availInBefore = availInAfter;
                    if (!async) return true;
                    var newReq = self2._handle.write(flushFlag, chunk, inOff, availInBefore, self2._buffer, self2._offset, self2._chunkSize);
                    newReq.callback = callback;
                    newReq.buffer = chunk;
                    return;
                  }
                  if (!async) return false;
                  cb();
                }
              };
              util.inherits(Deflate, Zlib);
              util.inherits(Inflate, Zlib);
              util.inherits(Gzip, Zlib);
              util.inherits(Gunzip, Zlib);
              util.inherits(DeflateRaw, Zlib);
              util.inherits(InflateRaw, Zlib);
              util.inherits(Unzip, Zlib);
            }).call(this);
          }).call(this, require2("_process"));
        }, { "./binding": 30, "_process": 63, "assert": 23, "buffer": 32, "stream": 65, "util": 84 }], 32: [function(require2, module3, exports3) {
          (function(Buffer2) {
            (function() {
              "use strict";
              var base64 = require2("base64-js");
              var ieee754 = require2("ieee754");
              exports3.Buffer = Buffer3;
              exports3.SlowBuffer = SlowBuffer;
              exports3.INSPECT_MAX_BYTES = 50;
              var K_MAX_LENGTH = 2147483647;
              exports3.kMaxLength = K_MAX_LENGTH;
              Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
              if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
                console.error(
                  "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
                );
              }
              function typedArraySupport() {
                try {
                  var arr = new Uint8Array(1);
                  arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function() {
                    return 42;
                  } };
                  return arr.foo() === 42;
                } catch (e) {
                  return false;
                }
              }
              Object.defineProperty(Buffer3.prototype, "parent", {
                enumerable: true,
                get: function() {
                  if (!Buffer3.isBuffer(this)) return void 0;
                  return this.buffer;
                }
              });
              Object.defineProperty(Buffer3.prototype, "offset", {
                enumerable: true,
                get: function() {
                  if (!Buffer3.isBuffer(this)) return void 0;
                  return this.byteOffset;
                }
              });
              function createBuffer(length) {
                if (length > K_MAX_LENGTH) {
                  throw new RangeError('The value "' + length + '" is invalid for option "size"');
                }
                var buf = new Uint8Array(length);
                buf.__proto__ = Buffer3.prototype;
                return buf;
              }
              function Buffer3(arg, encodingOrOffset, length) {
                if (typeof arg === "number") {
                  if (typeof encodingOrOffset === "string") {
                    throw new TypeError(
                      'The "string" argument must be of type string. Received type number'
                    );
                  }
                  return allocUnsafe(arg);
                }
                return from(arg, encodingOrOffset, length);
              }
              if (typeof Symbol !== "undefined" && Symbol.species != null && Buffer3[Symbol.species] === Buffer3) {
                Object.defineProperty(Buffer3, Symbol.species, {
                  value: null,
                  configurable: true,
                  enumerable: false,
                  writable: false
                });
              }
              Buffer3.poolSize = 8192;
              function from(value, encodingOrOffset, length) {
                if (typeof value === "string") {
                  return fromString(value, encodingOrOffset);
                }
                if (ArrayBuffer.isView(value)) {
                  return fromArrayLike(value);
                }
                if (value == null) {
                  throw TypeError(
                    "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
                  );
                }
                if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
                  return fromArrayBuffer(value, encodingOrOffset, length);
                }
                if (typeof value === "number") {
                  throw new TypeError(
                    'The "value" argument must not be of type number. Received type number'
                  );
                }
                var valueOf = value.valueOf && value.valueOf();
                if (valueOf != null && valueOf !== value) {
                  return Buffer3.from(valueOf, encodingOrOffset, length);
                }
                var b = fromObject(value);
                if (b) return b;
                if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
                  return Buffer3.from(
                    value[Symbol.toPrimitive]("string"),
                    encodingOrOffset,
                    length
                  );
                }
                throw new TypeError(
                  "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
                );
              }
              Buffer3.from = function(value, encodingOrOffset, length) {
                return from(value, encodingOrOffset, length);
              };
              Buffer3.prototype.__proto__ = Uint8Array.prototype;
              Buffer3.__proto__ = Uint8Array;
              function assertSize(size) {
                if (typeof size !== "number") {
                  throw new TypeError('"size" argument must be of type number');
                } else if (size < 0) {
                  throw new RangeError('The value "' + size + '" is invalid for option "size"');
                }
              }
              function alloc(size, fill, encoding) {
                assertSize(size);
                if (size <= 0) {
                  return createBuffer(size);
                }
                if (fill !== void 0) {
                  return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
                }
                return createBuffer(size);
              }
              Buffer3.alloc = function(size, fill, encoding) {
                return alloc(size, fill, encoding);
              };
              function allocUnsafe(size) {
                assertSize(size);
                return createBuffer(size < 0 ? 0 : checked(size) | 0);
              }
              Buffer3.allocUnsafe = function(size) {
                return allocUnsafe(size);
              };
              Buffer3.allocUnsafeSlow = function(size) {
                return allocUnsafe(size);
              };
              function fromString(string, encoding) {
                if (typeof encoding !== "string" || encoding === "") {
                  encoding = "utf8";
                }
                if (!Buffer3.isEncoding(encoding)) {
                  throw new TypeError("Unknown encoding: " + encoding);
                }
                var length = byteLength(string, encoding) | 0;
                var buf = createBuffer(length);
                var actual = buf.write(string, encoding);
                if (actual !== length) {
                  buf = buf.slice(0, actual);
                }
                return buf;
              }
              function fromArrayLike(array) {
                var length = array.length < 0 ? 0 : checked(array.length) | 0;
                var buf = createBuffer(length);
                for (var i = 0; i < length; i += 1) {
                  buf[i] = array[i] & 255;
                }
                return buf;
              }
              function fromArrayBuffer(array, byteOffset, length) {
                if (byteOffset < 0 || array.byteLength < byteOffset) {
                  throw new RangeError('"offset" is outside of buffer bounds');
                }
                if (array.byteLength < byteOffset + (length || 0)) {
                  throw new RangeError('"length" is outside of buffer bounds');
                }
                var buf;
                if (byteOffset === void 0 && length === void 0) {
                  buf = new Uint8Array(array);
                } else if (length === void 0) {
                  buf = new Uint8Array(array, byteOffset);
                } else {
                  buf = new Uint8Array(array, byteOffset, length);
                }
                buf.__proto__ = Buffer3.prototype;
                return buf;
              }
              function fromObject(obj) {
                if (Buffer3.isBuffer(obj)) {
                  var len = checked(obj.length) | 0;
                  var buf = createBuffer(len);
                  if (buf.length === 0) {
                    return buf;
                  }
                  obj.copy(buf, 0, 0, len);
                  return buf;
                }
                if (obj.length !== void 0) {
                  if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
                    return createBuffer(0);
                  }
                  return fromArrayLike(obj);
                }
                if (obj.type === "Buffer" && Array.isArray(obj.data)) {
                  return fromArrayLike(obj.data);
                }
              }
              function checked(length) {
                if (length >= K_MAX_LENGTH) {
                  throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
                }
                return length | 0;
              }
              function SlowBuffer(length) {
                if (+length != length) {
                  length = 0;
                }
                return Buffer3.alloc(+length);
              }
              Buffer3.isBuffer = function isBuffer(b) {
                return b != null && b._isBuffer === true && b !== Buffer3.prototype;
              };
              Buffer3.compare = function compare(a, b) {
                if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
                if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
                if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
                  throw new TypeError(
                    'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
                  );
                }
                if (a === b) return 0;
                var x = a.length;
                var y = b.length;
                for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                  if (a[i] !== b[i]) {
                    x = a[i];
                    y = b[i];
                    break;
                  }
                }
                if (x < y) return -1;
                if (y < x) return 1;
                return 0;
              };
              Buffer3.isEncoding = function isEncoding(encoding) {
                switch (String(encoding).toLowerCase()) {
                  case "hex":
                  case "utf8":
                  case "utf-8":
                  case "ascii":
                  case "latin1":
                  case "binary":
                  case "base64":
                  case "ucs2":
                  case "ucs-2":
                  case "utf16le":
                  case "utf-16le":
                    return true;
                  default:
                    return false;
                }
              };
              Buffer3.concat = function concat(list, length) {
                if (!Array.isArray(list)) {
                  throw new TypeError('"list" argument must be an Array of Buffers');
                }
                if (list.length === 0) {
                  return Buffer3.alloc(0);
                }
                var i;
                if (length === void 0) {
                  length = 0;
                  for (i = 0; i < list.length; ++i) {
                    length += list[i].length;
                  }
                }
                var buffer = Buffer3.allocUnsafe(length);
                var pos = 0;
                for (i = 0; i < list.length; ++i) {
                  var buf = list[i];
                  if (isInstance(buf, Uint8Array)) {
                    buf = Buffer3.from(buf);
                  }
                  if (!Buffer3.isBuffer(buf)) {
                    throw new TypeError('"list" argument must be an Array of Buffers');
                  }
                  buf.copy(buffer, pos);
                  pos += buf.length;
                }
                return buffer;
              };
              function byteLength(string, encoding) {
                if (Buffer3.isBuffer(string)) {
                  return string.length;
                }
                if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
                  return string.byteLength;
                }
                if (typeof string !== "string") {
                  throw new TypeError(
                    'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
                  );
                }
                var len = string.length;
                var mustMatch = arguments.length > 2 && arguments[2] === true;
                if (!mustMatch && len === 0) return 0;
                var loweredCase = false;
                for (; ; ) {
                  switch (encoding) {
                    case "ascii":
                    case "latin1":
                    case "binary":
                      return len;
                    case "utf8":
                    case "utf-8":
                      return utf8ToBytes(string).length;
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                      return len * 2;
                    case "hex":
                      return len >>> 1;
                    case "base64":
                      return base64ToBytes(string).length;
                    default:
                      if (loweredCase) {
                        return mustMatch ? -1 : utf8ToBytes(string).length;
                      }
                      encoding = ("" + encoding).toLowerCase();
                      loweredCase = true;
                  }
                }
              }
              Buffer3.byteLength = byteLength;
              function slowToString(encoding, start, end) {
                var loweredCase = false;
                if (start === void 0 || start < 0) {
                  start = 0;
                }
                if (start > this.length) {
                  return "";
                }
                if (end === void 0 || end > this.length) {
                  end = this.length;
                }
                if (end <= 0) {
                  return "";
                }
                end >>>= 0;
                start >>>= 0;
                if (end <= start) {
                  return "";
                }
                if (!encoding) encoding = "utf8";
                while (true) {
                  switch (encoding) {
                    case "hex":
                      return hexSlice(this, start, end);
                    case "utf8":
                    case "utf-8":
                      return utf8Slice(this, start, end);
                    case "ascii":
                      return asciiSlice(this, start, end);
                    case "latin1":
                    case "binary":
                      return latin1Slice(this, start, end);
                    case "base64":
                      return base64Slice(this, start, end);
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                      return utf16leSlice(this, start, end);
                    default:
                      if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                      encoding = (encoding + "").toLowerCase();
                      loweredCase = true;
                  }
                }
              }
              Buffer3.prototype._isBuffer = true;
              function swap(b, n, m) {
                var i = b[n];
                b[n] = b[m];
                b[m] = i;
              }
              Buffer3.prototype.swap16 = function swap16() {
                var len = this.length;
                if (len % 2 !== 0) {
                  throw new RangeError("Buffer size must be a multiple of 16-bits");
                }
                for (var i = 0; i < len; i += 2) {
                  swap(this, i, i + 1);
                }
                return this;
              };
              Buffer3.prototype.swap32 = function swap32() {
                var len = this.length;
                if (len % 4 !== 0) {
                  throw new RangeError("Buffer size must be a multiple of 32-bits");
                }
                for (var i = 0; i < len; i += 4) {
                  swap(this, i, i + 3);
                  swap(this, i + 1, i + 2);
                }
                return this;
              };
              Buffer3.prototype.swap64 = function swap64() {
                var len = this.length;
                if (len % 8 !== 0) {
                  throw new RangeError("Buffer size must be a multiple of 64-bits");
                }
                for (var i = 0; i < len; i += 8) {
                  swap(this, i, i + 7);
                  swap(this, i + 1, i + 6);
                  swap(this, i + 2, i + 5);
                  swap(this, i + 3, i + 4);
                }
                return this;
              };
              Buffer3.prototype.toString = function toString() {
                var length = this.length;
                if (length === 0) return "";
                if (arguments.length === 0) return utf8Slice(this, 0, length);
                return slowToString.apply(this, arguments);
              };
              Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
              Buffer3.prototype.equals = function equals(b) {
                if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
                if (this === b) return true;
                return Buffer3.compare(this, b) === 0;
              };
              Buffer3.prototype.inspect = function inspect() {
                var str = "";
                var max = exports3.INSPECT_MAX_BYTES;
                str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
                if (this.length > max) str += " ... ";
                return "<Buffer " + str + ">";
              };
              Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
                if (isInstance(target, Uint8Array)) {
                  target = Buffer3.from(target, target.offset, target.byteLength);
                }
                if (!Buffer3.isBuffer(target)) {
                  throw new TypeError(
                    'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
                  );
                }
                if (start === void 0) {
                  start = 0;
                }
                if (end === void 0) {
                  end = target ? target.length : 0;
                }
                if (thisStart === void 0) {
                  thisStart = 0;
                }
                if (thisEnd === void 0) {
                  thisEnd = this.length;
                }
                if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
                  throw new RangeError("out of range index");
                }
                if (thisStart >= thisEnd && start >= end) {
                  return 0;
                }
                if (thisStart >= thisEnd) {
                  return -1;
                }
                if (start >= end) {
                  return 1;
                }
                start >>>= 0;
                end >>>= 0;
                thisStart >>>= 0;
                thisEnd >>>= 0;
                if (this === target) return 0;
                var x = thisEnd - thisStart;
                var y = end - start;
                var len = Math.min(x, y);
                var thisCopy = this.slice(thisStart, thisEnd);
                var targetCopy = target.slice(start, end);
                for (var i = 0; i < len; ++i) {
                  if (thisCopy[i] !== targetCopy[i]) {
                    x = thisCopy[i];
                    y = targetCopy[i];
                    break;
                  }
                }
                if (x < y) return -1;
                if (y < x) return 1;
                return 0;
              };
              function bidirectionalIndexOf(buffer, val2, byteOffset, encoding, dir) {
                if (buffer.length === 0) return -1;
                if (typeof byteOffset === "string") {
                  encoding = byteOffset;
                  byteOffset = 0;
                } else if (byteOffset > 2147483647) {
                  byteOffset = 2147483647;
                } else if (byteOffset < -2147483648) {
                  byteOffset = -2147483648;
                }
                byteOffset = +byteOffset;
                if (numberIsNaN(byteOffset)) {
                  byteOffset = dir ? 0 : buffer.length - 1;
                }
                if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
                if (byteOffset >= buffer.length) {
                  if (dir) return -1;
                  else byteOffset = buffer.length - 1;
                } else if (byteOffset < 0) {
                  if (dir) byteOffset = 0;
                  else return -1;
                }
                if (typeof val2 === "string") {
                  val2 = Buffer3.from(val2, encoding);
                }
                if (Buffer3.isBuffer(val2)) {
                  if (val2.length === 0) {
                    return -1;
                  }
                  return arrayIndexOf(buffer, val2, byteOffset, encoding, dir);
                } else if (typeof val2 === "number") {
                  val2 = val2 & 255;
                  if (typeof Uint8Array.prototype.indexOf === "function") {
                    if (dir) {
                      return Uint8Array.prototype.indexOf.call(buffer, val2, byteOffset);
                    } else {
                      return Uint8Array.prototype.lastIndexOf.call(buffer, val2, byteOffset);
                    }
                  }
                  return arrayIndexOf(buffer, [val2], byteOffset, encoding, dir);
                }
                throw new TypeError("val must be string, number or Buffer");
              }
              function arrayIndexOf(arr, val2, byteOffset, encoding, dir) {
                var indexSize = 1;
                var arrLength = arr.length;
                var valLength = val2.length;
                if (encoding !== void 0) {
                  encoding = String(encoding).toLowerCase();
                  if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
                    if (arr.length < 2 || val2.length < 2) {
                      return -1;
                    }
                    indexSize = 2;
                    arrLength /= 2;
                    valLength /= 2;
                    byteOffset /= 2;
                  }
                }
                function read(buf, i2) {
                  if (indexSize === 1) {
                    return buf[i2];
                  } else {
                    return buf.readUInt16BE(i2 * indexSize);
                  }
                }
                var i;
                if (dir) {
                  var foundIndex = -1;
                  for (i = byteOffset; i < arrLength; i++) {
                    if (read(arr, i) === read(val2, foundIndex === -1 ? 0 : i - foundIndex)) {
                      if (foundIndex === -1) foundIndex = i;
                      if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
                    } else {
                      if (foundIndex !== -1) i -= i - foundIndex;
                      foundIndex = -1;
                    }
                  }
                } else {
                  if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
                  for (i = byteOffset; i >= 0; i--) {
                    var found = true;
                    for (var j = 0; j < valLength; j++) {
                      if (read(arr, i + j) !== read(val2, j)) {
                        found = false;
                        break;
                      }
                    }
                    if (found) return i;
                  }
                }
                return -1;
              }
              Buffer3.prototype.includes = function includes(val2, byteOffset, encoding) {
                return this.indexOf(val2, byteOffset, encoding) !== -1;
              };
              Buffer3.prototype.indexOf = function indexOf(val2, byteOffset, encoding) {
                return bidirectionalIndexOf(this, val2, byteOffset, encoding, true);
              };
              Buffer3.prototype.lastIndexOf = function lastIndexOf(val2, byteOffset, encoding) {
                return bidirectionalIndexOf(this, val2, byteOffset, encoding, false);
              };
              function hexWrite(buf, string, offset, length) {
                offset = Number(offset) || 0;
                var remaining = buf.length - offset;
                if (!length) {
                  length = remaining;
                } else {
                  length = Number(length);
                  if (length > remaining) {
                    length = remaining;
                  }
                }
                var strLen = string.length;
                if (length > strLen / 2) {
                  length = strLen / 2;
                }
                for (var i = 0; i < length; ++i) {
                  var parsed = parseInt(string.substr(i * 2, 2), 16);
                  if (numberIsNaN(parsed)) return i;
                  buf[offset + i] = parsed;
                }
                return i;
              }
              function utf8Write(buf, string, offset, length) {
                return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
              }
              function asciiWrite(buf, string, offset, length) {
                return blitBuffer(asciiToBytes(string), buf, offset, length);
              }
              function latin1Write(buf, string, offset, length) {
                return asciiWrite(buf, string, offset, length);
              }
              function base64Write(buf, string, offset, length) {
                return blitBuffer(base64ToBytes(string), buf, offset, length);
              }
              function ucs2Write(buf, string, offset, length) {
                return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
              }
              Buffer3.prototype.write = function write(string, offset, length, encoding) {
                if (offset === void 0) {
                  encoding = "utf8";
                  length = this.length;
                  offset = 0;
                } else if (length === void 0 && typeof offset === "string") {
                  encoding = offset;
                  length = this.length;
                  offset = 0;
                } else if (isFinite(offset)) {
                  offset = offset >>> 0;
                  if (isFinite(length)) {
                    length = length >>> 0;
                    if (encoding === void 0) encoding = "utf8";
                  } else {
                    encoding = length;
                    length = void 0;
                  }
                } else {
                  throw new Error(
                    "Buffer.write(string, encoding, offset[, length]) is no longer supported"
                  );
                }
                var remaining = this.length - offset;
                if (length === void 0 || length > remaining) length = remaining;
                if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
                  throw new RangeError("Attempt to write outside buffer bounds");
                }
                if (!encoding) encoding = "utf8";
                var loweredCase = false;
                for (; ; ) {
                  switch (encoding) {
                    case "hex":
                      return hexWrite(this, string, offset, length);
                    case "utf8":
                    case "utf-8":
                      return utf8Write(this, string, offset, length);
                    case "ascii":
                      return asciiWrite(this, string, offset, length);
                    case "latin1":
                    case "binary":
                      return latin1Write(this, string, offset, length);
                    case "base64":
                      return base64Write(this, string, offset, length);
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                      return ucs2Write(this, string, offset, length);
                    default:
                      if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                      encoding = ("" + encoding).toLowerCase();
                      loweredCase = true;
                  }
                }
              };
              Buffer3.prototype.toJSON = function toJSON() {
                return {
                  type: "Buffer",
                  data: Array.prototype.slice.call(this._arr || this, 0)
                };
              };
              function base64Slice(buf, start, end) {
                if (start === 0 && end === buf.length) {
                  return base64.fromByteArray(buf);
                } else {
                  return base64.fromByteArray(buf.slice(start, end));
                }
              }
              function utf8Slice(buf, start, end) {
                end = Math.min(buf.length, end);
                var res = [];
                var i = start;
                while (i < end) {
                  var firstByte = buf[i];
                  var codePoint = null;
                  var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
                  if (i + bytesPerSequence <= end) {
                    var secondByte, thirdByte, fourthByte, tempCodePoint;
                    switch (bytesPerSequence) {
                      case 1:
                        if (firstByte < 128) {
                          codePoint = firstByte;
                        }
                        break;
                      case 2:
                        secondByte = buf[i + 1];
                        if ((secondByte & 192) === 128) {
                          tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                          if (tempCodePoint > 127) {
                            codePoint = tempCodePoint;
                          }
                        }
                        break;
                      case 3:
                        secondByte = buf[i + 1];
                        thirdByte = buf[i + 2];
                        if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                          tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                          if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                            codePoint = tempCodePoint;
                          }
                        }
                        break;
                      case 4:
                        secondByte = buf[i + 1];
                        thirdByte = buf[i + 2];
                        fourthByte = buf[i + 3];
                        if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                          tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                          if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                            codePoint = tempCodePoint;
                          }
                        }
                    }
                  }
                  if (codePoint === null) {
                    codePoint = 65533;
                    bytesPerSequence = 1;
                  } else if (codePoint > 65535) {
                    codePoint -= 65536;
                    res.push(codePoint >>> 10 & 1023 | 55296);
                    codePoint = 56320 | codePoint & 1023;
                  }
                  res.push(codePoint);
                  i += bytesPerSequence;
                }
                return decodeCodePointsArray(res);
              }
              var MAX_ARGUMENTS_LENGTH = 4096;
              function decodeCodePointsArray(codePoints) {
                var len = codePoints.length;
                if (len <= MAX_ARGUMENTS_LENGTH) {
                  return String.fromCharCode.apply(String, codePoints);
                }
                var res = "";
                var i = 0;
                while (i < len) {
                  res += String.fromCharCode.apply(
                    String,
                    codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
                  );
                }
                return res;
              }
              function asciiSlice(buf, start, end) {
                var ret = "";
                end = Math.min(buf.length, end);
                for (var i = start; i < end; ++i) {
                  ret += String.fromCharCode(buf[i] & 127);
                }
                return ret;
              }
              function latin1Slice(buf, start, end) {
                var ret = "";
                end = Math.min(buf.length, end);
                for (var i = start; i < end; ++i) {
                  ret += String.fromCharCode(buf[i]);
                }
                return ret;
              }
              function hexSlice(buf, start, end) {
                var len = buf.length;
                if (!start || start < 0) start = 0;
                if (!end || end < 0 || end > len) end = len;
                var out = "";
                for (var i = start; i < end; ++i) {
                  out += toHex(buf[i]);
                }
                return out;
              }
              function utf16leSlice(buf, start, end) {
                var bytes = buf.slice(start, end);
                var res = "";
                for (var i = 0; i < bytes.length; i += 2) {
                  res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
                }
                return res;
              }
              Buffer3.prototype.slice = function slice(start, end) {
                var len = this.length;
                start = ~~start;
                end = end === void 0 ? len : ~~end;
                if (start < 0) {
                  start += len;
                  if (start < 0) start = 0;
                } else if (start > len) {
                  start = len;
                }
                if (end < 0) {
                  end += len;
                  if (end < 0) end = 0;
                } else if (end > len) {
                  end = len;
                }
                if (end < start) end = start;
                var newBuf = this.subarray(start, end);
                newBuf.__proto__ = Buffer3.prototype;
                return newBuf;
              };
              function checkOffset(offset, ext, length) {
                if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
                if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
              }
              Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) checkOffset(offset, byteLength2, this.length);
                var val2 = this[offset];
                var mul = 1;
                var i = 0;
                while (++i < byteLength2 && (mul *= 256)) {
                  val2 += this[offset + i] * mul;
                }
                return val2;
              };
              Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) {
                  checkOffset(offset, byteLength2, this.length);
                }
                var val2 = this[offset + --byteLength2];
                var mul = 1;
                while (byteLength2 > 0 && (mul *= 256)) {
                  val2 += this[offset + --byteLength2] * mul;
                }
                return val2;
              };
              Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 1, this.length);
                return this[offset];
              };
              Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 2, this.length);
                return this[offset] | this[offset + 1] << 8;
              };
              Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 2, this.length);
                return this[offset] << 8 | this[offset + 1];
              };
              Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
              };
              Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
              };
              Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) checkOffset(offset, byteLength2, this.length);
                var val2 = this[offset];
                var mul = 1;
                var i = 0;
                while (++i < byteLength2 && (mul *= 256)) {
                  val2 += this[offset + i] * mul;
                }
                mul *= 128;
                if (val2 >= mul) val2 -= Math.pow(2, 8 * byteLength2);
                return val2;
              };
              Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) checkOffset(offset, byteLength2, this.length);
                var i = byteLength2;
                var mul = 1;
                var val2 = this[offset + --i];
                while (i > 0 && (mul *= 256)) {
                  val2 += this[offset + --i] * mul;
                }
                mul *= 128;
                if (val2 >= mul) val2 -= Math.pow(2, 8 * byteLength2);
                return val2;
              };
              Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 1, this.length);
                if (!(this[offset] & 128)) return this[offset];
                return (255 - this[offset] + 1) * -1;
              };
              Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 2, this.length);
                var val2 = this[offset] | this[offset + 1] << 8;
                return val2 & 32768 ? val2 | 4294901760 : val2;
              };
              Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 2, this.length);
                var val2 = this[offset + 1] | this[offset] << 8;
                return val2 & 32768 ? val2 | 4294901760 : val2;
              };
              Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
              };
              Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
              };
              Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return ieee754.read(this, offset, true, 23, 4);
              };
              Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 4, this.length);
                return ieee754.read(this, offset, false, 23, 4);
              };
              Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 8, this.length);
                return ieee754.read(this, offset, true, 52, 8);
              };
              Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
                offset = offset >>> 0;
                if (!noAssert) checkOffset(offset, 8, this.length);
                return ieee754.read(this, offset, false, 52, 8);
              };
              function checkInt(buf, value, offset, ext, max, min) {
                if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
                if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
                if (offset + ext > buf.length) throw new RangeError("Index out of range");
              }
              Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
                value = +value;
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) {
                  var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
                  checkInt(this, value, offset, byteLength2, maxBytes, 0);
                }
                var mul = 1;
                var i = 0;
                this[offset] = value & 255;
                while (++i < byteLength2 && (mul *= 256)) {
                  this[offset + i] = value / mul & 255;
                }
                return offset + byteLength2;
              };
              Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
                value = +value;
                offset = offset >>> 0;
                byteLength2 = byteLength2 >>> 0;
                if (!noAssert) {
                  var maxBytes = Math.pow(2, 8 * byteLength2) - 1;
                  checkInt(this, value, offset, byteLength2, maxBytes, 0);
                }
                var i = byteLength2 - 1;
                var mul = 1;
                this[offset + i] = value & 255;
                while (--i >= 0 && (mul *= 256)) {
                  this[offset + i] = value / mul & 255;
                }
                return offset + byteLength2;
              };
              Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
                this[offset] = value & 255;
                return offset + 1;
              };
              Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
                this[offset] = value & 255;
                this[offset + 1] = value >>> 8;
                return offset + 2;
              };
              Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
                this[offset] = value >>> 8;
                this[offset + 1] = value & 255;
                return offset + 2;
              };
              Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
                this[offset + 3] = value >>> 24;
                this[offset + 2] = value >>> 16;
                this[offset + 1] = value >>> 8;
                this[offset] = value & 255;
                return offset + 4;
              };
              Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
                this[offset] = value >>> 24;
                this[offset + 1] = value >>> 16;
                this[offset + 2] = value >>> 8;
                this[offset + 3] = value & 255;
                return offset + 4;
              };
              Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) {
                  var limit = Math.pow(2, 8 * byteLength2 - 1);
                  checkInt(this, value, offset, byteLength2, limit - 1, -limit);
                }
                var i = 0;
                var mul = 1;
                var sub = 0;
                this[offset] = value & 255;
                while (++i < byteLength2 && (mul *= 256)) {
                  if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
                    sub = 1;
                  }
                  this[offset + i] = (value / mul >> 0) - sub & 255;
                }
                return offset + byteLength2;
              };
              Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) {
                  var limit = Math.pow(2, 8 * byteLength2 - 1);
                  checkInt(this, value, offset, byteLength2, limit - 1, -limit);
                }
                var i = byteLength2 - 1;
                var mul = 1;
                var sub = 0;
                this[offset + i] = value & 255;
                while (--i >= 0 && (mul *= 256)) {
                  if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
                    sub = 1;
                  }
                  this[offset + i] = (value / mul >> 0) - sub & 255;
                }
                return offset + byteLength2;
              };
              Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
                if (value < 0) value = 255 + value + 1;
                this[offset] = value & 255;
                return offset + 1;
              };
              Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
                this[offset] = value & 255;
                this[offset + 1] = value >>> 8;
                return offset + 2;
              };
              Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
                this[offset] = value >>> 8;
                this[offset + 1] = value & 255;
                return offset + 2;
              };
              Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
                this[offset] = value & 255;
                this[offset + 1] = value >>> 8;
                this[offset + 2] = value >>> 16;
                this[offset + 3] = value >>> 24;
                return offset + 4;
              };
              Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
                if (value < 0) value = 4294967295 + value + 1;
                this[offset] = value >>> 24;
                this[offset + 1] = value >>> 16;
                this[offset + 2] = value >>> 8;
                this[offset + 3] = value & 255;
                return offset + 4;
              };
              function checkIEEE754(buf, value, offset, ext, max, min) {
                if (offset + ext > buf.length) throw new RangeError("Index out of range");
                if (offset < 0) throw new RangeError("Index out of range");
              }
              function writeFloat(buf, value, offset, littleEndian, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) {
                  checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
                }
                ieee754.write(buf, value, offset, littleEndian, 23, 4);
                return offset + 4;
              }
              Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
                return writeFloat(this, value, offset, true, noAssert);
              };
              Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
                return writeFloat(this, value, offset, false, noAssert);
              };
              function writeDouble(buf, value, offset, littleEndian, noAssert) {
                value = +value;
                offset = offset >>> 0;
                if (!noAssert) {
                  checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
                }
                ieee754.write(buf, value, offset, littleEndian, 52, 8);
                return offset + 8;
              }
              Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
                return writeDouble(this, value, offset, true, noAssert);
              };
              Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
                return writeDouble(this, value, offset, false, noAssert);
              };
              Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
                if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
                if (!start) start = 0;
                if (!end && end !== 0) end = this.length;
                if (targetStart >= target.length) targetStart = target.length;
                if (!targetStart) targetStart = 0;
                if (end > 0 && end < start) end = start;
                if (end === start) return 0;
                if (target.length === 0 || this.length === 0) return 0;
                if (targetStart < 0) {
                  throw new RangeError("targetStart out of bounds");
                }
                if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
                if (end < 0) throw new RangeError("sourceEnd out of bounds");
                if (end > this.length) end = this.length;
                if (target.length - targetStart < end - start) {
                  end = target.length - targetStart + start;
                }
                var len = end - start;
                if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
                  this.copyWithin(targetStart, start, end);
                } else if (this === target && start < targetStart && targetStart < end) {
                  for (var i = len - 1; i >= 0; --i) {
                    target[i + targetStart] = this[i + start];
                  }
                } else {
                  Uint8Array.prototype.set.call(
                    target,
                    this.subarray(start, end),
                    targetStart
                  );
                }
                return len;
              };
              Buffer3.prototype.fill = function fill(val2, start, end, encoding) {
                if (typeof val2 === "string") {
                  if (typeof start === "string") {
                    encoding = start;
                    start = 0;
                    end = this.length;
                  } else if (typeof end === "string") {
                    encoding = end;
                    end = this.length;
                  }
                  if (encoding !== void 0 && typeof encoding !== "string") {
                    throw new TypeError("encoding must be a string");
                  }
                  if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
                    throw new TypeError("Unknown encoding: " + encoding);
                  }
                  if (val2.length === 1) {
                    var code = val2.charCodeAt(0);
                    if (encoding === "utf8" && code < 128 || encoding === "latin1") {
                      val2 = code;
                    }
                  }
                } else if (typeof val2 === "number") {
                  val2 = val2 & 255;
                }
                if (start < 0 || this.length < start || this.length < end) {
                  throw new RangeError("Out of range index");
                }
                if (end <= start) {
                  return this;
                }
                start = start >>> 0;
                end = end === void 0 ? this.length : end >>> 0;
                if (!val2) val2 = 0;
                var i;
                if (typeof val2 === "number") {
                  for (i = start; i < end; ++i) {
                    this[i] = val2;
                  }
                } else {
                  var bytes = Buffer3.isBuffer(val2) ? val2 : Buffer3.from(val2, encoding);
                  var len = bytes.length;
                  if (len === 0) {
                    throw new TypeError('The value "' + val2 + '" is invalid for argument "value"');
                  }
                  for (i = 0; i < end - start; ++i) {
                    this[i + start] = bytes[i % len];
                  }
                }
                return this;
              };
              var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
              function base64clean(str) {
                str = str.split("=")[0];
                str = str.trim().replace(INVALID_BASE64_RE, "");
                if (str.length < 2) return "";
                while (str.length % 4 !== 0) {
                  str = str + "=";
                }
                return str;
              }
              function toHex(n) {
                if (n < 16) return "0" + n.toString(16);
                return n.toString(16);
              }
              function utf8ToBytes(string, units) {
                units = units || Infinity;
                var codePoint;
                var length = string.length;
                var leadSurrogate = null;
                var bytes = [];
                for (var i = 0; i < length; ++i) {
                  codePoint = string.charCodeAt(i);
                  if (codePoint > 55295 && codePoint < 57344) {
                    if (!leadSurrogate) {
                      if (codePoint > 56319) {
                        if ((units -= 3) > -1) bytes.push(239, 191, 189);
                        continue;
                      } else if (i + 1 === length) {
                        if ((units -= 3) > -1) bytes.push(239, 191, 189);
                        continue;
                      }
                      leadSurrogate = codePoint;
                      continue;
                    }
                    if (codePoint < 56320) {
                      if ((units -= 3) > -1) bytes.push(239, 191, 189);
                      leadSurrogate = codePoint;
                      continue;
                    }
                    codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
                  } else if (leadSurrogate) {
                    if ((units -= 3) > -1) bytes.push(239, 191, 189);
                  }
                  leadSurrogate = null;
                  if (codePoint < 128) {
                    if ((units -= 1) < 0) break;
                    bytes.push(codePoint);
                  } else if (codePoint < 2048) {
                    if ((units -= 2) < 0) break;
                    bytes.push(
                      codePoint >> 6 | 192,
                      codePoint & 63 | 128
                    );
                  } else if (codePoint < 65536) {
                    if ((units -= 3) < 0) break;
                    bytes.push(
                      codePoint >> 12 | 224,
                      codePoint >> 6 & 63 | 128,
                      codePoint & 63 | 128
                    );
                  } else if (codePoint < 1114112) {
                    if ((units -= 4) < 0) break;
                    bytes.push(
                      codePoint >> 18 | 240,
                      codePoint >> 12 & 63 | 128,
                      codePoint >> 6 & 63 | 128,
                      codePoint & 63 | 128
                    );
                  } else {
                    throw new Error("Invalid code point");
                  }
                }
                return bytes;
              }
              function asciiToBytes(str) {
                var byteArray = [];
                for (var i = 0; i < str.length; ++i) {
                  byteArray.push(str.charCodeAt(i) & 255);
                }
                return byteArray;
              }
              function utf16leToBytes(str, units) {
                var c, hi, lo;
                var byteArray = [];
                for (var i = 0; i < str.length; ++i) {
                  if ((units -= 2) < 0) break;
                  c = str.charCodeAt(i);
                  hi = c >> 8;
                  lo = c % 256;
                  byteArray.push(lo);
                  byteArray.push(hi);
                }
                return byteArray;
              }
              function base64ToBytes(str) {
                return base64.toByteArray(base64clean(str));
              }
              function blitBuffer(src, dst, offset, length) {
                for (var i = 0; i < length; ++i) {
                  if (i + offset >= dst.length || i >= src.length) break;
                  dst[i + offset] = src[i];
                }
                return i;
              }
              function isInstance(obj, type) {
                return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
              }
              function numberIsNaN(obj) {
                return obj !== obj;
              }
            }).call(this);
          }).call(this, require2("buffer").Buffer);
        }, { "base64-js": 28, "buffer": 32, "ieee754": 45 }], 33: [function(require2, module3, exports3) {
          "use strict";
          var GetIntrinsic = require2("get-intrinsic");
          var callBind = require2("./");
          var $indexOf = callBind(GetIntrinsic("String.prototype.indexOf"));
          module3.exports = function callBoundIntrinsic(name, allowMissing) {
            var intrinsic = GetIntrinsic(name, !!allowMissing);
            if (typeof intrinsic === "function" && $indexOf(name, ".prototype.") > -1) {
              return callBind(intrinsic);
            }
            return intrinsic;
          };
        }, { "./": 34, "get-intrinsic": 39 }], 34: [function(require2, module3, exports3) {
          "use strict";
          var bind = require2("function-bind");
          var GetIntrinsic = require2("get-intrinsic");
          var $apply = GetIntrinsic("%Function.prototype.apply%");
          var $call = GetIntrinsic("%Function.prototype.call%");
          var $reflectApply = GetIntrinsic("%Reflect.apply%", true) || bind.call($call, $apply);
          var $gOPD = GetIntrinsic("%Object.getOwnPropertyDescriptor%", true);
          var $defineProperty = GetIntrinsic("%Object.defineProperty%", true);
          var $max = GetIntrinsic("%Math.max%");
          if ($defineProperty) {
            try {
              $defineProperty({}, "a", { value: 1 });
            } catch (e) {
              $defineProperty = null;
            }
          }
          module3.exports = function callBind(originalFunction) {
            var func = $reflectApply(bind, $call, arguments);
            if ($gOPD && $defineProperty) {
              var desc = $gOPD(func, "length");
              if (desc.configurable) {
                $defineProperty(
                  func,
                  "length",
                  { value: 1 + $max(0, originalFunction.length - (arguments.length - 1)) }
                );
              }
            }
            return func;
          };
          var applyBind = function applyBind2() {
            return $reflectApply(bind, $apply, arguments);
          };
          if ($defineProperty) {
            $defineProperty(module3.exports, "apply", { value: applyBind });
          } else {
            module3.exports.apply = applyBind;
          }
        }, { "function-bind": 38, "get-intrinsic": 39 }], 35: [function(require2, module3, exports3) {
          "use strict";
          var R = typeof Reflect === "object" ? Reflect : null;
          var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
            return Function.prototype.apply.call(target, receiver, args);
          };
          var ReflectOwnKeys;
          if (R && typeof R.ownKeys === "function") {
            ReflectOwnKeys = R.ownKeys;
          } else if (Object.getOwnPropertySymbols) {
            ReflectOwnKeys = function ReflectOwnKeys2(target) {
              return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
            };
          } else {
            ReflectOwnKeys = function ReflectOwnKeys2(target) {
              return Object.getOwnPropertyNames(target);
            };
          }
          function ProcessEmitWarning(warning) {
            if (console && console.warn) console.warn(warning);
          }
          var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
            return value !== value;
          };
          function EventEmitter() {
            EventEmitter.init.call(this);
          }
          module3.exports = EventEmitter;
          module3.exports.once = once;
          EventEmitter.EventEmitter = EventEmitter;
          EventEmitter.prototype._events = void 0;
          EventEmitter.prototype._eventsCount = 0;
          EventEmitter.prototype._maxListeners = void 0;
          var defaultMaxListeners = 10;
          function checkListener(listener) {
            if (typeof listener !== "function") {
              throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
            }
          }
          Object.defineProperty(EventEmitter, "defaultMaxListeners", {
            enumerable: true,
            get: function() {
              return defaultMaxListeners;
            },
            set: function(arg) {
              if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
                throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
              }
              defaultMaxListeners = arg;
            }
          });
          EventEmitter.init = function() {
            if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
              this._events = /* @__PURE__ */ Object.create(null);
              this._eventsCount = 0;
            }
            this._maxListeners = this._maxListeners || void 0;
          };
          EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
            if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
              throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
            }
            this._maxListeners = n;
            return this;
          };
          function _getMaxListeners(that) {
            if (that._maxListeners === void 0)
              return EventEmitter.defaultMaxListeners;
            return that._maxListeners;
          }
          EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
            return _getMaxListeners(this);
          };
          EventEmitter.prototype.emit = function emit(type) {
            var args = [];
            for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
            var doError = type === "error";
            var events = this._events;
            if (events !== void 0)
              doError = doError && events.error === void 0;
            else if (!doError)
              return false;
            if (doError) {
              var er;
              if (args.length > 0)
                er = args[0];
              if (er instanceof Error) {
                throw er;
              }
              var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
              err.context = er;
              throw err;
            }
            var handler = events[type];
            if (handler === void 0)
              return false;
            if (typeof handler === "function") {
              ReflectApply(handler, this, args);
            } else {
              var len = handler.length;
              var listeners = arrayClone(handler, len);
              for (var i = 0; i < len; ++i)
                ReflectApply(listeners[i], this, args);
            }
            return true;
          };
          function _addListener(target, type, listener, prepend) {
            var m;
            var events;
            var existing;
            checkListener(listener);
            events = target._events;
            if (events === void 0) {
              events = target._events = /* @__PURE__ */ Object.create(null);
              target._eventsCount = 0;
            } else {
              if (events.newListener !== void 0) {
                target.emit(
                  "newListener",
                  type,
                  listener.listener ? listener.listener : listener
                );
                events = target._events;
              }
              existing = events[type];
            }
            if (existing === void 0) {
              existing = events[type] = listener;
              ++target._eventsCount;
            } else {
              if (typeof existing === "function") {
                existing = events[type] = prepend ? [listener, existing] : [existing, listener];
              } else if (prepend) {
                existing.unshift(listener);
              } else {
                existing.push(listener);
              }
              m = _getMaxListeners(target);
              if (m > 0 && existing.length > m && !existing.warned) {
                existing.warned = true;
                var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
                w.name = "MaxListenersExceededWarning";
                w.emitter = target;
                w.type = type;
                w.count = existing.length;
                ProcessEmitWarning(w);
              }
            }
            return target;
          }
          EventEmitter.prototype.addListener = function addListener(type, listener) {
            return _addListener(this, type, listener, false);
          };
          EventEmitter.prototype.on = EventEmitter.prototype.addListener;
          EventEmitter.prototype.prependListener = function prependListener(type, listener) {
            return _addListener(this, type, listener, true);
          };
          function onceWrapper() {
            if (!this.fired) {
              this.target.removeListener(this.type, this.wrapFn);
              this.fired = true;
              if (arguments.length === 0)
                return this.listener.call(this.target);
              return this.listener.apply(this.target, arguments);
            }
          }
          function _onceWrap(target, type, listener) {
            var state = { fired: false, wrapFn: void 0, target, type, listener };
            var wrapped = onceWrapper.bind(state);
            wrapped.listener = listener;
            state.wrapFn = wrapped;
            return wrapped;
          }
          EventEmitter.prototype.once = function once2(type, listener) {
            checkListener(listener);
            this.on(type, _onceWrap(this, type, listener));
            return this;
          };
          EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
            checkListener(listener);
            this.prependListener(type, _onceWrap(this, type, listener));
            return this;
          };
          EventEmitter.prototype.removeListener = function removeListener(type, listener) {
            var list, events, position, i, originalListener;
            checkListener(listener);
            events = this._events;
            if (events === void 0)
              return this;
            list = events[type];
            if (list === void 0)
              return this;
            if (list === listener || list.listener === listener) {
              if (--this._eventsCount === 0)
                this._events = /* @__PURE__ */ Object.create(null);
              else {
                delete events[type];
                if (events.removeListener)
                  this.emit("removeListener", type, list.listener || listener);
              }
            } else if (typeof list !== "function") {
              position = -1;
              for (i = list.length - 1; i >= 0; i--) {
                if (list[i] === listener || list[i].listener === listener) {
                  originalListener = list[i].listener;
                  position = i;
                  break;
                }
              }
              if (position < 0)
                return this;
              if (position === 0)
                list.shift();
              else {
                spliceOne(list, position);
              }
              if (list.length === 1)
                events[type] = list[0];
              if (events.removeListener !== void 0)
                this.emit("removeListener", type, originalListener || listener);
            }
            return this;
          };
          EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
          EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
            var listeners, events, i;
            events = this._events;
            if (events === void 0)
              return this;
            if (events.removeListener === void 0) {
              if (arguments.length === 0) {
                this._events = /* @__PURE__ */ Object.create(null);
                this._eventsCount = 0;
              } else if (events[type] !== void 0) {
                if (--this._eventsCount === 0)
                  this._events = /* @__PURE__ */ Object.create(null);
                else
                  delete events[type];
              }
              return this;
            }
            if (arguments.length === 0) {
              var keys = Object.keys(events);
              var key;
              for (i = 0; i < keys.length; ++i) {
                key = keys[i];
                if (key === "removeListener") continue;
                this.removeAllListeners(key);
              }
              this.removeAllListeners("removeListener");
              this._events = /* @__PURE__ */ Object.create(null);
              this._eventsCount = 0;
              return this;
            }
            listeners = events[type];
            if (typeof listeners === "function") {
              this.removeListener(type, listeners);
            } else if (listeners !== void 0) {
              for (i = listeners.length - 1; i >= 0; i--) {
                this.removeListener(type, listeners[i]);
              }
            }
            return this;
          };
          function _listeners(target, type, unwrap) {
            var events = target._events;
            if (events === void 0)
              return [];
            var evlistener = events[type];
            if (evlistener === void 0)
              return [];
            if (typeof evlistener === "function")
              return unwrap ? [evlistener.listener || evlistener] : [evlistener];
            return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
          }
          EventEmitter.prototype.listeners = function listeners(type) {
            return _listeners(this, type, true);
          };
          EventEmitter.prototype.rawListeners = function rawListeners(type) {
            return _listeners(this, type, false);
          };
          EventEmitter.listenerCount = function(emitter, type) {
            if (typeof emitter.listenerCount === "function") {
              return emitter.listenerCount(type);
            } else {
              return listenerCount.call(emitter, type);
            }
          };
          EventEmitter.prototype.listenerCount = listenerCount;
          function listenerCount(type) {
            var events = this._events;
            if (events !== void 0) {
              var evlistener = events[type];
              if (typeof evlistener === "function") {
                return 1;
              } else if (evlistener !== void 0) {
                return evlistener.length;
              }
            }
            return 0;
          }
          EventEmitter.prototype.eventNames = function eventNames() {
            return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
          };
          function arrayClone(arr, n) {
            var copy = new Array(n);
            for (var i = 0; i < n; ++i)
              copy[i] = arr[i];
            return copy;
          }
          function spliceOne(list, index) {
            for (; index + 1 < list.length; index++)
              list[index] = list[index + 1];
            list.pop();
          }
          function unwrapListeners(arr) {
            var ret = new Array(arr.length);
            for (var i = 0; i < ret.length; ++i) {
              ret[i] = arr[i].listener || arr[i];
            }
            return ret;
          }
          function once(emitter, name) {
            return new Promise(function(resolve, reject) {
              function errorListener(err) {
                emitter.removeListener(name, resolver);
                reject(err);
              }
              function resolver() {
                if (typeof emitter.removeListener === "function") {
                  emitter.removeListener("error", errorListener);
                }
                resolve([].slice.call(arguments));
              }
              ;
              eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
              if (name !== "error") {
                addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
              }
            });
          }
          function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
            if (typeof emitter.on === "function") {
              eventTargetAgnosticAddListener(emitter, "error", handler, flags);
            }
          }
          function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
            if (typeof emitter.on === "function") {
              if (flags.once) {
                emitter.once(name, listener);
              } else {
                emitter.on(name, listener);
              }
            } else if (typeof emitter.addEventListener === "function") {
              emitter.addEventListener(name, function wrapListener(arg) {
                if (flags.once) {
                  emitter.removeEventListener(name, wrapListener);
                }
                listener(arg);
              });
            } else {
              throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
            }
          }
        }, {}], 36: [function(require2, module3, exports3) {
          "use strict";
          var isCallable = require2("is-callable");
          var toStr = Object.prototype.toString;
          var hasOwnProperty = Object.prototype.hasOwnProperty;
          var forEachArray = function forEachArray2(array, iterator, receiver) {
            for (var i = 0, len = array.length; i < len; i++) {
              if (hasOwnProperty.call(array, i)) {
                if (receiver == null) {
                  iterator(array[i], i, array);
                } else {
                  iterator.call(receiver, array[i], i, array);
                }
              }
            }
          };
          var forEachString = function forEachString2(string, iterator, receiver) {
            for (var i = 0, len = string.length; i < len; i++) {
              if (receiver == null) {
                iterator(string.charAt(i), i, string);
              } else {
                iterator.call(receiver, string.charAt(i), i, string);
              }
            }
          };
          var forEachObject = function forEachObject2(object, iterator, receiver) {
            for (var k in object) {
              if (hasOwnProperty.call(object, k)) {
                if (receiver == null) {
                  iterator(object[k], k, object);
                } else {
                  iterator.call(receiver, object[k], k, object);
                }
              }
            }
          };
          var forEach = function forEach2(list, iterator, thisArg) {
            if (!isCallable(iterator)) {
              throw new TypeError("iterator must be a function");
            }
            var receiver;
            if (arguments.length >= 3) {
              receiver = thisArg;
            }
            if (toStr.call(list) === "[object Array]") {
              forEachArray(list, iterator, receiver);
            } else if (typeof list === "string") {
              forEachString(list, iterator, receiver);
            } else {
              forEachObject(list, iterator, receiver);
            }
          };
          module3.exports = forEach;
        }, { "is-callable": 48 }], 37: [function(require2, module3, exports3) {
          "use strict";
          var ERROR_MESSAGE = "Function.prototype.bind called on incompatible ";
          var slice = Array.prototype.slice;
          var toStr = Object.prototype.toString;
          var funcType = "[object Function]";
          module3.exports = function bind(that) {
            var target = this;
            if (typeof target !== "function" || toStr.call(target) !== funcType) {
              throw new TypeError(ERROR_MESSAGE + target);
            }
            var args = slice.call(arguments, 1);
            var bound;
            var binder = function() {
              if (this instanceof bound) {
                var result = target.apply(
                  this,
                  args.concat(slice.call(arguments))
                );
                if (Object(result) === result) {
                  return result;
                }
                return this;
              } else {
                return target.apply(
                  that,
                  args.concat(slice.call(arguments))
                );
              }
            };
            var boundLength = Math.max(0, target.length - args.length);
            var boundArgs = [];
            for (var i = 0; i < boundLength; i++) {
              boundArgs.push("$" + i);
            }
            bound = Function("binder", "return function (" + boundArgs.join(",") + "){ return binder.apply(this,arguments); }")(binder);
            if (target.prototype) {
              var Empty = function Empty2() {
              };
              Empty.prototype = target.prototype;
              bound.prototype = new Empty();
              Empty.prototype = null;
            }
            return bound;
          };
        }, {}], 38: [function(require2, module3, exports3) {
          "use strict";
          var implementation = require2("./implementation");
          module3.exports = Function.prototype.bind || implementation;
        }, { "./implementation": 37 }], 39: [function(require2, module3, exports3) {
          "use strict";
          var undefined2;
          var $SyntaxError = SyntaxError;
          var $Function = Function;
          var $TypeError = TypeError;
          var getEvalledConstructor = function(expressionSyntax) {
            try {
              return $Function('"use strict"; return (' + expressionSyntax + ").constructor;")();
            } catch (e) {
            }
          };
          var $gOPD = Object.getOwnPropertyDescriptor;
          if ($gOPD) {
            try {
              $gOPD({}, "");
            } catch (e) {
              $gOPD = null;
            }
          }
          var throwTypeError = function() {
            throw new $TypeError();
          };
          var ThrowTypeError = $gOPD ? function() {
            try {
              arguments.callee;
              return throwTypeError;
            } catch (calleeThrows) {
              try {
                return $gOPD(arguments, "callee").get;
              } catch (gOPDthrows) {
                return throwTypeError;
              }
            }
          }() : throwTypeError;
          var hasSymbols = require2("has-symbols")();
          var getProto = Object.getPrototypeOf || function(x) {
            return x.__proto__;
          };
          var needsEval = {};
          var TypedArray = typeof Uint8Array === "undefined" ? undefined2 : getProto(Uint8Array);
          var INTRINSICS = {
            "%AggregateError%": typeof AggregateError === "undefined" ? undefined2 : AggregateError,
            "%Array%": Array,
            "%ArrayBuffer%": typeof ArrayBuffer === "undefined" ? undefined2 : ArrayBuffer,
            "%ArrayIteratorPrototype%": hasSymbols ? getProto([][Symbol.iterator]()) : undefined2,
            "%AsyncFromSyncIteratorPrototype%": undefined2,
            "%AsyncFunction%": needsEval,
            "%AsyncGenerator%": needsEval,
            "%AsyncGeneratorFunction%": needsEval,
            "%AsyncIteratorPrototype%": needsEval,
            "%Atomics%": typeof Atomics === "undefined" ? undefined2 : Atomics,
            "%BigInt%": typeof BigInt === "undefined" ? undefined2 : BigInt,
            "%BigInt64Array%": typeof BigInt64Array === "undefined" ? undefined2 : BigInt64Array,
            "%BigUint64Array%": typeof BigUint64Array === "undefined" ? undefined2 : BigUint64Array,
            "%Boolean%": Boolean,
            "%DataView%": typeof DataView === "undefined" ? undefined2 : DataView,
            "%Date%": Date,
            "%decodeURI%": decodeURI,
            "%decodeURIComponent%": decodeURIComponent,
            "%encodeURI%": encodeURI,
            "%encodeURIComponent%": encodeURIComponent,
            "%Error%": Error,
            "%eval%": eval,
            // eslint-disable-line no-eval
            "%EvalError%": EvalError,
            "%Float32Array%": typeof Float32Array === "undefined" ? undefined2 : Float32Array,
            "%Float64Array%": typeof Float64Array === "undefined" ? undefined2 : Float64Array,
            "%FinalizationRegistry%": typeof FinalizationRegistry === "undefined" ? undefined2 : FinalizationRegistry,
            "%Function%": $Function,
            "%GeneratorFunction%": needsEval,
            "%Int8Array%": typeof Int8Array === "undefined" ? undefined2 : Int8Array,
            "%Int16Array%": typeof Int16Array === "undefined" ? undefined2 : Int16Array,
            "%Int32Array%": typeof Int32Array === "undefined" ? undefined2 : Int32Array,
            "%isFinite%": isFinite,
            "%isNaN%": isNaN,
            "%IteratorPrototype%": hasSymbols ? getProto(getProto([][Symbol.iterator]())) : undefined2,
            "%JSON%": typeof JSON === "object" ? JSON : undefined2,
            "%Map%": typeof Map === "undefined" ? undefined2 : Map,
            "%MapIteratorPrototype%": typeof Map === "undefined" || !hasSymbols ? undefined2 : getProto((/* @__PURE__ */ new Map())[Symbol.iterator]()),
            "%Math%": Math,
            "%Number%": Number,
            "%Object%": Object,
            "%parseFloat%": parseFloat,
            "%parseInt%": parseInt,
            "%Promise%": typeof Promise === "undefined" ? undefined2 : Promise,
            "%Proxy%": typeof Proxy === "undefined" ? undefined2 : Proxy,
            "%RangeError%": RangeError,
            "%ReferenceError%": ReferenceError,
            "%Reflect%": typeof Reflect === "undefined" ? undefined2 : Reflect,
            "%RegExp%": RegExp,
            "%Set%": typeof Set === "undefined" ? undefined2 : Set,
            "%SetIteratorPrototype%": typeof Set === "undefined" || !hasSymbols ? undefined2 : getProto((/* @__PURE__ */ new Set())[Symbol.iterator]()),
            "%SharedArrayBuffer%": typeof SharedArrayBuffer === "undefined" ? undefined2 : SharedArrayBuffer,
            "%String%": String,
            "%StringIteratorPrototype%": hasSymbols ? getProto(""[Symbol.iterator]()) : undefined2,
            "%Symbol%": hasSymbols ? Symbol : undefined2,
            "%SyntaxError%": $SyntaxError,
            "%ThrowTypeError%": ThrowTypeError,
            "%TypedArray%": TypedArray,
            "%TypeError%": $TypeError,
            "%Uint8Array%": typeof Uint8Array === "undefined" ? undefined2 : Uint8Array,
            "%Uint8ClampedArray%": typeof Uint8ClampedArray === "undefined" ? undefined2 : Uint8ClampedArray,
            "%Uint16Array%": typeof Uint16Array === "undefined" ? undefined2 : Uint16Array,
            "%Uint32Array%": typeof Uint32Array === "undefined" ? undefined2 : Uint32Array,
            "%URIError%": URIError,
            "%WeakMap%": typeof WeakMap === "undefined" ? undefined2 : WeakMap,
            "%WeakRef%": typeof WeakRef === "undefined" ? undefined2 : WeakRef,
            "%WeakSet%": typeof WeakSet === "undefined" ? undefined2 : WeakSet
          };
          try {
            null.error;
          } catch (e) {
            var errorProto = getProto(getProto(e));
            INTRINSICS["%Error.prototype%"] = errorProto;
          }
          var doEval = function doEval2(name) {
            var value;
            if (name === "%AsyncFunction%") {
              value = getEvalledConstructor("async function () {}");
            } else if (name === "%GeneratorFunction%") {
              value = getEvalledConstructor("function* () {}");
            } else if (name === "%AsyncGeneratorFunction%") {
              value = getEvalledConstructor("async function* () {}");
            } else if (name === "%AsyncGenerator%") {
              var fn = doEval2("%AsyncGeneratorFunction%");
              if (fn) {
                value = fn.prototype;
              }
            } else if (name === "%AsyncIteratorPrototype%") {
              var gen = doEval2("%AsyncGenerator%");
              if (gen) {
                value = getProto(gen.prototype);
              }
            }
            INTRINSICS[name] = value;
            return value;
          };
          var LEGACY_ALIASES = {
            "%ArrayBufferPrototype%": ["ArrayBuffer", "prototype"],
            "%ArrayPrototype%": ["Array", "prototype"],
            "%ArrayProto_entries%": ["Array", "prototype", "entries"],
            "%ArrayProto_forEach%": ["Array", "prototype", "forEach"],
            "%ArrayProto_keys%": ["Array", "prototype", "keys"],
            "%ArrayProto_values%": ["Array", "prototype", "values"],
            "%AsyncFunctionPrototype%": ["AsyncFunction", "prototype"],
            "%AsyncGenerator%": ["AsyncGeneratorFunction", "prototype"],
            "%AsyncGeneratorPrototype%": ["AsyncGeneratorFunction", "prototype", "prototype"],
            "%BooleanPrototype%": ["Boolean", "prototype"],
            "%DataViewPrototype%": ["DataView", "prototype"],
            "%DatePrototype%": ["Date", "prototype"],
            "%ErrorPrototype%": ["Error", "prototype"],
            "%EvalErrorPrototype%": ["EvalError", "prototype"],
            "%Float32ArrayPrototype%": ["Float32Array", "prototype"],
            "%Float64ArrayPrototype%": ["Float64Array", "prototype"],
            "%FunctionPrototype%": ["Function", "prototype"],
            "%Generator%": ["GeneratorFunction", "prototype"],
            "%GeneratorPrototype%": ["GeneratorFunction", "prototype", "prototype"],
            "%Int8ArrayPrototype%": ["Int8Array", "prototype"],
            "%Int16ArrayPrototype%": ["Int16Array", "prototype"],
            "%Int32ArrayPrototype%": ["Int32Array", "prototype"],
            "%JSONParse%": ["JSON", "parse"],
            "%JSONStringify%": ["JSON", "stringify"],
            "%MapPrototype%": ["Map", "prototype"],
            "%NumberPrototype%": ["Number", "prototype"],
            "%ObjectPrototype%": ["Object", "prototype"],
            "%ObjProto_toString%": ["Object", "prototype", "toString"],
            "%ObjProto_valueOf%": ["Object", "prototype", "valueOf"],
            "%PromisePrototype%": ["Promise", "prototype"],
            "%PromiseProto_then%": ["Promise", "prototype", "then"],
            "%Promise_all%": ["Promise", "all"],
            "%Promise_reject%": ["Promise", "reject"],
            "%Promise_resolve%": ["Promise", "resolve"],
            "%RangeErrorPrototype%": ["RangeError", "prototype"],
            "%ReferenceErrorPrototype%": ["ReferenceError", "prototype"],
            "%RegExpPrototype%": ["RegExp", "prototype"],
            "%SetPrototype%": ["Set", "prototype"],
            "%SharedArrayBufferPrototype%": ["SharedArrayBuffer", "prototype"],
            "%StringPrototype%": ["String", "prototype"],
            "%SymbolPrototype%": ["Symbol", "prototype"],
            "%SyntaxErrorPrototype%": ["SyntaxError", "prototype"],
            "%TypedArrayPrototype%": ["TypedArray", "prototype"],
            "%TypeErrorPrototype%": ["TypeError", "prototype"],
            "%Uint8ArrayPrototype%": ["Uint8Array", "prototype"],
            "%Uint8ClampedArrayPrototype%": ["Uint8ClampedArray", "prototype"],
            "%Uint16ArrayPrototype%": ["Uint16Array", "prototype"],
            "%Uint32ArrayPrototype%": ["Uint32Array", "prototype"],
            "%URIErrorPrototype%": ["URIError", "prototype"],
            "%WeakMapPrototype%": ["WeakMap", "prototype"],
            "%WeakSetPrototype%": ["WeakSet", "prototype"]
          };
          var bind = require2("function-bind");
          var hasOwn = require2("has");
          var $concat = bind.call(Function.call, Array.prototype.concat);
          var $spliceApply = bind.call(Function.apply, Array.prototype.splice);
          var $replace = bind.call(Function.call, String.prototype.replace);
          var $strSlice = bind.call(Function.call, String.prototype.slice);
          var $exec = bind.call(Function.call, RegExp.prototype.exec);
          var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
          var reEscapeChar = /\\(\\)?/g;
          var stringToPath = function stringToPath2(string) {
            var first = $strSlice(string, 0, 1);
            var last = $strSlice(string, -1);
            if (first === "%" && last !== "%") {
              throw new $SyntaxError("invalid intrinsic syntax, expected closing `%`");
            } else if (last === "%" && first !== "%") {
              throw new $SyntaxError("invalid intrinsic syntax, expected opening `%`");
            }
            var result = [];
            $replace(string, rePropName, function(match, number, quote, subString) {
              result[result.length] = quote ? $replace(subString, reEscapeChar, "$1") : number || match;
            });
            return result;
          };
          var getBaseIntrinsic = function getBaseIntrinsic2(name, allowMissing) {
            var intrinsicName = name;
            var alias;
            if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
              alias = LEGACY_ALIASES[intrinsicName];
              intrinsicName = "%" + alias[0] + "%";
            }
            if (hasOwn(INTRINSICS, intrinsicName)) {
              var value = INTRINSICS[intrinsicName];
              if (value === needsEval) {
                value = doEval(intrinsicName);
              }
              if (typeof value === "undefined" && !allowMissing) {
                throw new $TypeError("intrinsic " + name + " exists, but is not available. Please file an issue!");
              }
              return {
                alias,
                name: intrinsicName,
                value
              };
            }
            throw new $SyntaxError("intrinsic " + name + " does not exist!");
          };
          module3.exports = function GetIntrinsic(name, allowMissing) {
            if (typeof name !== "string" || name.length === 0) {
              throw new $TypeError("intrinsic name must be a non-empty string");
            }
            if (arguments.length > 1 && typeof allowMissing !== "boolean") {
              throw new $TypeError('"allowMissing" argument must be a boolean');
            }
            if ($exec(/^%?[^%]*%?$/, name) === null) {
              throw new $SyntaxError("`%` may not be present anywhere but at the beginning and end of the intrinsic name");
            }
            var parts = stringToPath(name);
            var intrinsicBaseName = parts.length > 0 ? parts[0] : "";
            var intrinsic = getBaseIntrinsic("%" + intrinsicBaseName + "%", allowMissing);
            var intrinsicRealName = intrinsic.name;
            var value = intrinsic.value;
            var skipFurtherCaching = false;
            var alias = intrinsic.alias;
            if (alias) {
              intrinsicBaseName = alias[0];
              $spliceApply(parts, $concat([0, 1], alias));
            }
            for (var i = 1, isOwn = true; i < parts.length; i += 1) {
              var part = parts[i];
              var first = $strSlice(part, 0, 1);
              var last = $strSlice(part, -1);
              if ((first === '"' || first === "'" || first === "`" || (last === '"' || last === "'" || last === "`")) && first !== last) {
                throw new $SyntaxError("property names with quotes must have matching quotes");
              }
              if (part === "constructor" || !isOwn) {
                skipFurtherCaching = true;
              }
              intrinsicBaseName += "." + part;
              intrinsicRealName = "%" + intrinsicBaseName + "%";
              if (hasOwn(INTRINSICS, intrinsicRealName)) {
                value = INTRINSICS[intrinsicRealName];
              } else if (value != null) {
                if (!(part in value)) {
                  if (!allowMissing) {
                    throw new $TypeError("base intrinsic for " + name + " exists, but the property is not available.");
                  }
                  return void 0;
                }
                if ($gOPD && i + 1 >= parts.length) {
                  var desc = $gOPD(value, part);
                  isOwn = !!desc;
                  if (isOwn && "get" in desc && !("originalValue" in desc.get)) {
                    value = desc.get;
                  } else {
                    value = value[part];
                  }
                } else {
                  isOwn = hasOwn(value, part);
                  value = value[part];
                }
                if (isOwn && !skipFurtherCaching) {
                  INTRINSICS[intrinsicRealName] = value;
                }
              }
            }
            return value;
          };
        }, { "function-bind": 38, "has": 44, "has-symbols": 41 }], 40: [function(require2, module3, exports3) {
          "use strict";
          var GetIntrinsic = require2("get-intrinsic");
          var $gOPD = GetIntrinsic("%Object.getOwnPropertyDescriptor%", true);
          if ($gOPD) {
            try {
              $gOPD([], "length");
            } catch (e) {
              $gOPD = null;
            }
          }
          module3.exports = $gOPD;
        }, { "get-intrinsic": 39 }], 41: [function(require2, module3, exports3) {
          "use strict";
          var origSymbol = typeof Symbol !== "undefined" && Symbol;
          var hasSymbolSham = require2("./shams");
          module3.exports = function hasNativeSymbols() {
            if (typeof origSymbol !== "function") {
              return false;
            }
            if (typeof Symbol !== "function") {
              return false;
            }
            if (typeof origSymbol("foo") !== "symbol") {
              return false;
            }
            if (typeof Symbol("bar") !== "symbol") {
              return false;
            }
            return hasSymbolSham();
          };
        }, { "./shams": 42 }], 42: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = function hasSymbols() {
            if (typeof Symbol !== "function" || typeof Object.getOwnPropertySymbols !== "function") {
              return false;
            }
            if (typeof Symbol.iterator === "symbol") {
              return true;
            }
            var obj = {};
            var sym = Symbol("test");
            var symObj = Object(sym);
            if (typeof sym === "string") {
              return false;
            }
            if (Object.prototype.toString.call(sym) !== "[object Symbol]") {
              return false;
            }
            if (Object.prototype.toString.call(symObj) !== "[object Symbol]") {
              return false;
            }
            var symVal = 42;
            obj[sym] = symVal;
            for (sym in obj) {
              return false;
            }
            if (typeof Object.keys === "function" && Object.keys(obj).length !== 0) {
              return false;
            }
            if (typeof Object.getOwnPropertyNames === "function" && Object.getOwnPropertyNames(obj).length !== 0) {
              return false;
            }
            var syms = Object.getOwnPropertySymbols(obj);
            if (syms.length !== 1 || syms[0] !== sym) {
              return false;
            }
            if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) {
              return false;
            }
            if (typeof Object.getOwnPropertyDescriptor === "function") {
              var descriptor = Object.getOwnPropertyDescriptor(obj, sym);
              if (descriptor.value !== symVal || descriptor.enumerable !== true) {
                return false;
              }
            }
            return true;
          };
        }, {}], 43: [function(require2, module3, exports3) {
          "use strict";
          var hasSymbols = require2("has-symbols/shams");
          module3.exports = function hasToStringTagShams() {
            return hasSymbols() && !!Symbol.toStringTag;
          };
        }, { "has-symbols/shams": 42 }], 44: [function(require2, module3, exports3) {
          "use strict";
          var bind = require2("function-bind");
          module3.exports = bind.call(Function.call, Object.prototype.hasOwnProperty);
        }, { "function-bind": 38 }], 45: [function(require2, module3, exports3) {
          exports3.read = function(buffer, offset, isLE, mLen, nBytes) {
            var e, m;
            var eLen = nBytes * 8 - mLen - 1;
            var eMax = (1 << eLen) - 1;
            var eBias = eMax >> 1;
            var nBits = -7;
            var i = isLE ? nBytes - 1 : 0;
            var d = isLE ? -1 : 1;
            var s = buffer[offset + i];
            i += d;
            e = s & (1 << -nBits) - 1;
            s >>= -nBits;
            nBits += eLen;
            for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
            }
            m = e & (1 << -nBits) - 1;
            e >>= -nBits;
            nBits += mLen;
            for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
            }
            if (e === 0) {
              e = 1 - eBias;
            } else if (e === eMax) {
              return m ? NaN : (s ? -1 : 1) * Infinity;
            } else {
              m = m + Math.pow(2, mLen);
              e = e - eBias;
            }
            return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
          };
          exports3.write = function(buffer, value, offset, isLE, mLen, nBytes) {
            var e, m, c;
            var eLen = nBytes * 8 - mLen - 1;
            var eMax = (1 << eLen) - 1;
            var eBias = eMax >> 1;
            var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
            var i = isLE ? 0 : nBytes - 1;
            var d = isLE ? 1 : -1;
            var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
            value = Math.abs(value);
            if (isNaN(value) || value === Infinity) {
              m = isNaN(value) ? 1 : 0;
              e = eMax;
            } else {
              e = Math.floor(Math.log(value) / Math.LN2);
              if (value * (c = Math.pow(2, -e)) < 1) {
                e--;
                c *= 2;
              }
              if (e + eBias >= 1) {
                value += rt / c;
              } else {
                value += rt * Math.pow(2, 1 - eBias);
              }
              if (value * c >= 2) {
                e++;
                c /= 2;
              }
              if (e + eBias >= eMax) {
                m = 0;
                e = eMax;
              } else if (e + eBias >= 1) {
                m = (value * c - 1) * Math.pow(2, mLen);
                e = e + eBias;
              } else {
                m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
                e = 0;
              }
            }
            for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
            }
            e = e << mLen | m;
            eLen += mLen;
            for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
            }
            buffer[offset + i - d] |= s * 128;
          };
        }, {}], 46: [function(require2, module3, exports3) {
          if (typeof Object.create === "function") {
            module3.exports = function inherits(ctor, superCtor) {
              if (superCtor) {
                ctor.super_ = superCtor;
                ctor.prototype = Object.create(superCtor.prototype, {
                  constructor: {
                    value: ctor,
                    enumerable: false,
                    writable: true,
                    configurable: true
                  }
                });
              }
            };
          } else {
            module3.exports = function inherits(ctor, superCtor) {
              if (superCtor) {
                ctor.super_ = superCtor;
                var TempCtor = function() {
                };
                TempCtor.prototype = superCtor.prototype;
                ctor.prototype = new TempCtor();
                ctor.prototype.constructor = ctor;
              }
            };
          }
        }, {}], 47: [function(require2, module3, exports3) {
          "use strict";
          var hasToStringTag = require2("has-tostringtag/shams")();
          var callBound = require2("call-bind/callBound");
          var $toString = callBound("Object.prototype.toString");
          var isStandardArguments = function isArguments(value) {
            if (hasToStringTag && value && typeof value === "object" && Symbol.toStringTag in value) {
              return false;
            }
            return $toString(value) === "[object Arguments]";
          };
          var isLegacyArguments = function isArguments(value) {
            if (isStandardArguments(value)) {
              return true;
            }
            return value !== null && typeof value === "object" && typeof value.length === "number" && value.length >= 0 && $toString(value) !== "[object Array]" && $toString(value.callee) === "[object Function]";
          };
          var supportsStandardArguments = function() {
            return isStandardArguments(arguments);
          }();
          isStandardArguments.isLegacyArguments = isLegacyArguments;
          module3.exports = supportsStandardArguments ? isStandardArguments : isLegacyArguments;
        }, { "call-bind/callBound": 33, "has-tostringtag/shams": 43 }], 48: [function(require2, module3, exports3) {
          "use strict";
          var fnToStr = Function.prototype.toString;
          var reflectApply = typeof Reflect === "object" && Reflect !== null && Reflect.apply;
          var badArrayLike;
          var isCallableMarker;
          if (typeof reflectApply === "function" && typeof Object.defineProperty === "function") {
            try {
              badArrayLike = Object.defineProperty({}, "length", {
                get: function() {
                  throw isCallableMarker;
                }
              });
              isCallableMarker = {};
              reflectApply(function() {
                throw 42;
              }, null, badArrayLike);
            } catch (_) {
              if (_ !== isCallableMarker) {
                reflectApply = null;
              }
            }
          } else {
            reflectApply = null;
          }
          var constructorRegex = /^\s*class\b/;
          var isES6ClassFn = function isES6ClassFunction(value) {
            try {
              var fnStr = fnToStr.call(value);
              return constructorRegex.test(fnStr);
            } catch (e) {
              return false;
            }
          };
          var tryFunctionObject = function tryFunctionToStr(value) {
            try {
              if (isES6ClassFn(value)) {
                return false;
              }
              fnToStr.call(value);
              return true;
            } catch (e) {
              return false;
            }
          };
          var toStr = Object.prototype.toString;
          var objectClass = "[object Object]";
          var fnClass = "[object Function]";
          var genClass = "[object GeneratorFunction]";
          var ddaClass = "[object HTMLAllCollection]";
          var ddaClass2 = "[object HTML document.all class]";
          var ddaClass3 = "[object HTMLCollection]";
          var hasToStringTag = typeof Symbol === "function" && !!Symbol.toStringTag;
          var isIE68 = !(0 in [,]);
          var isDDA = function isDocumentDotAll() {
            return false;
          };
          if (typeof document === "object") {
            var all = document.all;
            if (toStr.call(all) === toStr.call(document.all)) {
              isDDA = function isDocumentDotAll(value) {
                if ((isIE68 || !value) && (typeof value === "undefined" || typeof value === "object")) {
                  try {
                    var str = toStr.call(value);
                    return (str === ddaClass || str === ddaClass2 || str === ddaClass3 || str === objectClass) && value("") == null;
                  } catch (e) {
                  }
                }
                return false;
              };
            }
          }
          module3.exports = reflectApply ? function isCallable(value) {
            if (isDDA(value)) {
              return true;
            }
            if (!value) {
              return false;
            }
            if (typeof value !== "function" && typeof value !== "object") {
              return false;
            }
            try {
              reflectApply(value, null, badArrayLike);
            } catch (e) {
              if (e !== isCallableMarker) {
                return false;
              }
            }
            return !isES6ClassFn(value) && tryFunctionObject(value);
          } : function isCallable(value) {
            if (isDDA(value)) {
              return true;
            }
            if (!value) {
              return false;
            }
            if (typeof value !== "function" && typeof value !== "object") {
              return false;
            }
            if (hasToStringTag) {
              return tryFunctionObject(value);
            }
            if (isES6ClassFn(value)) {
              return false;
            }
            var strClass = toStr.call(value);
            if (strClass !== fnClass && strClass !== genClass && !/^\[object HTML/.test(strClass)) {
              return false;
            }
            return tryFunctionObject(value);
          };
        }, {}], 49: [function(require2, module3, exports3) {
          "use strict";
          var toStr = Object.prototype.toString;
          var fnToStr = Function.prototype.toString;
          var isFnRegex = /^\s*(?:function)?\*/;
          var hasToStringTag = require2("has-tostringtag/shams")();
          var getProto = Object.getPrototypeOf;
          var getGeneratorFunc = function() {
            if (!hasToStringTag) {
              return false;
            }
            try {
              return Function("return function*() {}")();
            } catch (e) {
            }
          };
          var GeneratorFunction;
          module3.exports = function isGeneratorFunction(fn) {
            if (typeof fn !== "function") {
              return false;
            }
            if (isFnRegex.test(fnToStr.call(fn))) {
              return true;
            }
            if (!hasToStringTag) {
              var str = toStr.call(fn);
              return str === "[object GeneratorFunction]";
            }
            if (!getProto) {
              return false;
            }
            if (typeof GeneratorFunction === "undefined") {
              var generatorFunc = getGeneratorFunc();
              GeneratorFunction = generatorFunc ? getProto(generatorFunc) : false;
            }
            return getProto(fn) === GeneratorFunction;
          };
        }, { "has-tostringtag/shams": 43 }], 50: [function(require2, module3, exports3) {
          (function(global2) {
            (function() {
              "use strict";
              var forEach = require2("for-each");
              var availableTypedArrays = require2("available-typed-arrays");
              var callBound = require2("call-bind/callBound");
              var $toString = callBound("Object.prototype.toString");
              var hasToStringTag = require2("has-tostringtag/shams")();
              var gOPD = require2("gopd");
              var g = typeof globalThis === "undefined" ? global2 : globalThis;
              var typedArrays = availableTypedArrays();
              var $indexOf = callBound("Array.prototype.indexOf", true) || function indexOf(array, value) {
                for (var i = 0; i < array.length; i += 1) {
                  if (array[i] === value) {
                    return i;
                  }
                }
                return -1;
              };
              var $slice = callBound("String.prototype.slice");
              var toStrTags = {};
              var getPrototypeOf = Object.getPrototypeOf;
              if (hasToStringTag && gOPD && getPrototypeOf) {
                forEach(typedArrays, function(typedArray) {
                  var arr = new g[typedArray]();
                  if (Symbol.toStringTag in arr) {
                    var proto = getPrototypeOf(arr);
                    var descriptor = gOPD(proto, Symbol.toStringTag);
                    if (!descriptor) {
                      var superProto = getPrototypeOf(proto);
                      descriptor = gOPD(superProto, Symbol.toStringTag);
                    }
                    toStrTags[typedArray] = descriptor.get;
                  }
                });
              }
              var tryTypedArrays = function tryAllTypedArrays(value) {
                var anyTrue = false;
                forEach(toStrTags, function(getter, typedArray) {
                  if (!anyTrue) {
                    try {
                      anyTrue = getter.call(value) === typedArray;
                    } catch (e) {
                    }
                  }
                });
                return anyTrue;
              };
              module3.exports = function isTypedArray(value) {
                if (!value || typeof value !== "object") {
                  return false;
                }
                if (!hasToStringTag || !(Symbol.toStringTag in value)) {
                  var tag = $slice($toString(value), 8, -1);
                  return $indexOf(typedArrays, tag) > -1;
                }
                if (!gOPD) {
                  return false;
                }
                return tryTypedArrays(value);
              };
            }).call(this);
          }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "available-typed-arrays": 27, "call-bind/callBound": 33, "for-each": 36, "gopd": 40, "has-tostringtag/shams": 43 }], 51: [function(require2, module3, exports3) {
          "use strict";
          var getOwnPropertySymbols = Object.getOwnPropertySymbols;
          var hasOwnProperty = Object.prototype.hasOwnProperty;
          var propIsEnumerable = Object.prototype.propertyIsEnumerable;
          function toObject(val2) {
            if (val2 === null || val2 === void 0) {
              throw new TypeError("Object.assign cannot be called with null or undefined");
            }
            return Object(val2);
          }
          function shouldUseNative() {
            try {
              if (!Object.assign) {
                return false;
              }
              var test1 = new String("abc");
              test1[5] = "de";
              if (Object.getOwnPropertyNames(test1)[0] === "5") {
                return false;
              }
              var test2 = {};
              for (var i = 0; i < 10; i++) {
                test2["_" + String.fromCharCode(i)] = i;
              }
              var order2 = Object.getOwnPropertyNames(test2).map(function(n) {
                return test2[n];
              });
              if (order2.join("") !== "0123456789") {
                return false;
              }
              var test3 = {};
              "abcdefghijklmnopqrst".split("").forEach(function(letter) {
                test3[letter] = letter;
              });
              if (Object.keys(Object.assign({}, test3)).join("") !== "abcdefghijklmnopqrst") {
                return false;
              }
              return true;
            } catch (err) {
              return false;
            }
          }
          module3.exports = shouldUseNative() ? Object.assign : function(target, source) {
            var from;
            var to = toObject(target);
            var symbols;
            for (var s = 1; s < arguments.length; s++) {
              from = Object(arguments[s]);
              for (var key in from) {
                if (hasOwnProperty.call(from, key)) {
                  to[key] = from[key];
                }
              }
              if (getOwnPropertySymbols) {
                symbols = getOwnPropertySymbols(from);
                for (var i = 0; i < symbols.length; i++) {
                  if (propIsEnumerable.call(from, symbols[i])) {
                    to[symbols[i]] = from[symbols[i]];
                  }
                }
              }
            }
            return to;
          };
        }, {}], 52: [function(require2, module3, exports3) {
          "use strict";
          var TYPED_OK = typeof Uint8Array !== "undefined" && typeof Uint16Array !== "undefined" && typeof Int32Array !== "undefined";
          function _has(obj, key) {
            return Object.prototype.hasOwnProperty.call(obj, key);
          }
          exports3.assign = function(obj) {
            var sources = Array.prototype.slice.call(arguments, 1);
            while (sources.length) {
              var source = sources.shift();
              if (!source) {
                continue;
              }
              if (typeof source !== "object") {
                throw new TypeError(source + "must be non-object");
              }
              for (var p in source) {
                if (_has(source, p)) {
                  obj[p] = source[p];
                }
              }
            }
            return obj;
          };
          exports3.shrinkBuf = function(buf, size) {
            if (buf.length === size) {
              return buf;
            }
            if (buf.subarray) {
              return buf.subarray(0, size);
            }
            buf.length = size;
            return buf;
          };
          var fnTyped = {
            arraySet: function(dest, src, src_offs, len, dest_offs) {
              if (src.subarray && dest.subarray) {
                dest.set(src.subarray(src_offs, src_offs + len), dest_offs);
                return;
              }
              for (var i = 0; i < len; i++) {
                dest[dest_offs + i] = src[src_offs + i];
              }
            },
            // Join array of chunks to single array.
            flattenChunks: function(chunks) {
              var i, l, len, pos, chunk, result;
              len = 0;
              for (i = 0, l = chunks.length; i < l; i++) {
                len += chunks[i].length;
              }
              result = new Uint8Array(len);
              pos = 0;
              for (i = 0, l = chunks.length; i < l; i++) {
                chunk = chunks[i];
                result.set(chunk, pos);
                pos += chunk.length;
              }
              return result;
            }
          };
          var fnUntyped = {
            arraySet: function(dest, src, src_offs, len, dest_offs) {
              for (var i = 0; i < len; i++) {
                dest[dest_offs + i] = src[src_offs + i];
              }
            },
            // Join array of chunks to single array.
            flattenChunks: function(chunks) {
              return [].concat.apply([], chunks);
            }
          };
          exports3.setTyped = function(on) {
            if (on) {
              exports3.Buf8 = Uint8Array;
              exports3.Buf16 = Uint16Array;
              exports3.Buf32 = Int32Array;
              exports3.assign(exports3, fnTyped);
            } else {
              exports3.Buf8 = Array;
              exports3.Buf16 = Array;
              exports3.Buf32 = Array;
              exports3.assign(exports3, fnUntyped);
            }
          };
          exports3.setTyped(TYPED_OK);
        }, {}], 53: [function(require2, module3, exports3) {
          "use strict";
          function adler32(adler, buf, len, pos) {
            var s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
            while (len !== 0) {
              n = len > 2e3 ? 2e3 : len;
              len -= n;
              do {
                s1 = s1 + buf[pos++] | 0;
                s2 = s2 + s1 | 0;
              } while (--n);
              s1 %= 65521;
              s2 %= 65521;
            }
            return s1 | s2 << 16 | 0;
          }
          module3.exports = adler32;
        }, {}], 54: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = {
            /* Allowed flush values; see deflate() and inflate() below for details */
            Z_NO_FLUSH: 0,
            Z_PARTIAL_FLUSH: 1,
            Z_SYNC_FLUSH: 2,
            Z_FULL_FLUSH: 3,
            Z_FINISH: 4,
            Z_BLOCK: 5,
            Z_TREES: 6,
            /* Return codes for the compression/decompression functions. Negative values
            * are errors, positive values are used for special but normal events.
            */
            Z_OK: 0,
            Z_STREAM_END: 1,
            Z_NEED_DICT: 2,
            Z_ERRNO: -1,
            Z_STREAM_ERROR: -2,
            Z_DATA_ERROR: -3,
            //Z_MEM_ERROR:     -4,
            Z_BUF_ERROR: -5,
            //Z_VERSION_ERROR: -6,
            /* compression levels */
            Z_NO_COMPRESSION: 0,
            Z_BEST_SPEED: 1,
            Z_BEST_COMPRESSION: 9,
            Z_DEFAULT_COMPRESSION: -1,
            Z_FILTERED: 1,
            Z_HUFFMAN_ONLY: 2,
            Z_RLE: 3,
            Z_FIXED: 4,
            Z_DEFAULT_STRATEGY: 0,
            /* Possible values of the data_type field (though see inflate()) */
            Z_BINARY: 0,
            Z_TEXT: 1,
            //Z_ASCII:                1, // = Z_TEXT (deprecated)
            Z_UNKNOWN: 2,
            /* The deflate compression method */
            Z_DEFLATED: 8
            //Z_NULL:                 null // Use -1 or null inline, depending on var type
          };
        }, {}], 55: [function(require2, module3, exports3) {
          "use strict";
          function makeTable() {
            var c, table = [];
            for (var n = 0; n < 256; n++) {
              c = n;
              for (var k = 0; k < 8; k++) {
                c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
              }
              table[n] = c;
            }
            return table;
          }
          var crcTable = makeTable();
          function crc32(crc, buf, len, pos) {
            var t = crcTable, end = pos + len;
            crc ^= -1;
            for (var i = pos; i < end; i++) {
              crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
            }
            return crc ^ -1;
          }
          module3.exports = crc32;
        }, {}], 56: [function(require2, module3, exports3) {
          "use strict";
          var utils = require2("../utils/common");
          var trees = require2("./trees");
          var adler32 = require2("./adler32");
          var crc32 = require2("./crc32");
          var msg = require2("./messages");
          var Z_NO_FLUSH = 0;
          var Z_PARTIAL_FLUSH = 1;
          var Z_FULL_FLUSH = 3;
          var Z_FINISH = 4;
          var Z_BLOCK = 5;
          var Z_OK = 0;
          var Z_STREAM_END = 1;
          var Z_STREAM_ERROR = -2;
          var Z_DATA_ERROR = -3;
          var Z_BUF_ERROR = -5;
          var Z_DEFAULT_COMPRESSION = -1;
          var Z_FILTERED = 1;
          var Z_HUFFMAN_ONLY = 2;
          var Z_RLE = 3;
          var Z_FIXED = 4;
          var Z_DEFAULT_STRATEGY = 0;
          var Z_UNKNOWN = 2;
          var Z_DEFLATED = 8;
          var MAX_MEM_LEVEL = 9;
          var MAX_WBITS = 15;
          var DEF_MEM_LEVEL = 8;
          var LENGTH_CODES = 29;
          var LITERALS = 256;
          var L_CODES = LITERALS + 1 + LENGTH_CODES;
          var D_CODES = 30;
          var BL_CODES = 19;
          var HEAP_SIZE = 2 * L_CODES + 1;
          var MAX_BITS = 15;
          var MIN_MATCH = 3;
          var MAX_MATCH = 258;
          var MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
          var PRESET_DICT = 32;
          var INIT_STATE = 42;
          var EXTRA_STATE = 69;
          var NAME_STATE = 73;
          var COMMENT_STATE = 91;
          var HCRC_STATE = 103;
          var BUSY_STATE = 113;
          var FINISH_STATE = 666;
          var BS_NEED_MORE = 1;
          var BS_BLOCK_DONE = 2;
          var BS_FINISH_STARTED = 3;
          var BS_FINISH_DONE = 4;
          var OS_CODE = 3;
          function err(strm, errorCode) {
            strm.msg = msg[errorCode];
            return errorCode;
          }
          function rank(f) {
            return (f << 1) - (f > 4 ? 9 : 0);
          }
          function zero(buf) {
            var len = buf.length;
            while (--len >= 0) {
              buf[len] = 0;
            }
          }
          function flush_pending(strm) {
            var s = strm.state;
            var len = s.pending;
            if (len > strm.avail_out) {
              len = strm.avail_out;
            }
            if (len === 0) {
              return;
            }
            utils.arraySet(strm.output, s.pending_buf, s.pending_out, len, strm.next_out);
            strm.next_out += len;
            s.pending_out += len;
            strm.total_out += len;
            strm.avail_out -= len;
            s.pending -= len;
            if (s.pending === 0) {
              s.pending_out = 0;
            }
          }
          function flush_block_only(s, last) {
            trees._tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
            s.block_start = s.strstart;
            flush_pending(s.strm);
          }
          function put_byte(s, b) {
            s.pending_buf[s.pending++] = b;
          }
          function putShortMSB(s, b) {
            s.pending_buf[s.pending++] = b >>> 8 & 255;
            s.pending_buf[s.pending++] = b & 255;
          }
          function read_buf(strm, buf, start, size) {
            var len = strm.avail_in;
            if (len > size) {
              len = size;
            }
            if (len === 0) {
              return 0;
            }
            strm.avail_in -= len;
            utils.arraySet(buf, strm.input, strm.next_in, len, start);
            if (strm.state.wrap === 1) {
              strm.adler = adler32(strm.adler, buf, len, start);
            } else if (strm.state.wrap === 2) {
              strm.adler = crc32(strm.adler, buf, len, start);
            }
            strm.next_in += len;
            strm.total_in += len;
            return len;
          }
          function longest_match(s, cur_match) {
            var chain_length = s.max_chain_length;
            var scan = s.strstart;
            var match;
            var len;
            var best_len = s.prev_length;
            var nice_match = s.nice_match;
            var limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
            var _win = s.window;
            var wmask = s.w_mask;
            var prev = s.prev;
            var strend = s.strstart + MAX_MATCH;
            var scan_end1 = _win[scan + best_len - 1];
            var scan_end = _win[scan + best_len];
            if (s.prev_length >= s.good_match) {
              chain_length >>= 2;
            }
            if (nice_match > s.lookahead) {
              nice_match = s.lookahead;
            }
            do {
              match = cur_match;
              if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) {
                continue;
              }
              scan += 2;
              match++;
              do {
              } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
              len = MAX_MATCH - (strend - scan);
              scan = strend - MAX_MATCH;
              if (len > best_len) {
                s.match_start = cur_match;
                best_len = len;
                if (len >= nice_match) {
                  break;
                }
                scan_end1 = _win[scan + best_len - 1];
                scan_end = _win[scan + best_len];
              }
            } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
            if (best_len <= s.lookahead) {
              return best_len;
            }
            return s.lookahead;
          }
          function fill_window(s) {
            var _w_size = s.w_size;
            var p, n, m, more, str;
            do {
              more = s.window_size - s.lookahead - s.strstart;
              if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
                utils.arraySet(s.window, s.window, _w_size, _w_size, 0);
                s.match_start -= _w_size;
                s.strstart -= _w_size;
                s.block_start -= _w_size;
                n = s.hash_size;
                p = n;
                do {
                  m = s.head[--p];
                  s.head[p] = m >= _w_size ? m - _w_size : 0;
                } while (--n);
                n = _w_size;
                p = n;
                do {
                  m = s.prev[--p];
                  s.prev[p] = m >= _w_size ? m - _w_size : 0;
                } while (--n);
                more += _w_size;
              }
              if (s.strm.avail_in === 0) {
                break;
              }
              n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
              s.lookahead += n;
              if (s.lookahead + s.insert >= MIN_MATCH) {
                str = s.strstart - s.insert;
                s.ins_h = s.window[str];
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + 1]) & s.hash_mask;
                while (s.insert) {
                  s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + MIN_MATCH - 1]) & s.hash_mask;
                  s.prev[str & s.w_mask] = s.head[s.ins_h];
                  s.head[s.ins_h] = str;
                  str++;
                  s.insert--;
                  if (s.lookahead + s.insert < MIN_MATCH) {
                    break;
                  }
                }
              }
            } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
          }
          function deflate_stored(s, flush) {
            var max_block_size = 65535;
            if (max_block_size > s.pending_buf_size - 5) {
              max_block_size = s.pending_buf_size - 5;
            }
            for (; ; ) {
              if (s.lookahead <= 1) {
                fill_window(s);
                if (s.lookahead === 0 && flush === Z_NO_FLUSH) {
                  return BS_NEED_MORE;
                }
                if (s.lookahead === 0) {
                  break;
                }
              }
              s.strstart += s.lookahead;
              s.lookahead = 0;
              var max_start = s.block_start + max_block_size;
              if (s.strstart === 0 || s.strstart >= max_start) {
                s.lookahead = s.strstart - max_start;
                s.strstart = max_start;
                flush_block_only(s, false);
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              }
              if (s.strstart - s.block_start >= s.w_size - MIN_LOOKAHEAD) {
                flush_block_only(s, false);
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              }
            }
            s.insert = 0;
            if (flush === Z_FINISH) {
              flush_block_only(s, true);
              if (s.strm.avail_out === 0) {
                return BS_FINISH_STARTED;
              }
              return BS_FINISH_DONE;
            }
            if (s.strstart > s.block_start) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
            return BS_NEED_MORE;
          }
          function deflate_fast(s, flush) {
            var hash_head;
            var bflush;
            for (; ; ) {
              if (s.lookahead < MIN_LOOKAHEAD) {
                fill_window(s);
                if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
                  return BS_NEED_MORE;
                }
                if (s.lookahead === 0) {
                  break;
                }
              }
              hash_head = 0;
              if (s.lookahead >= MIN_MATCH) {
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                s.head[s.ins_h] = s.strstart;
              }
              if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
                s.match_length = longest_match(s, hash_head);
              }
              if (s.match_length >= MIN_MATCH) {
                bflush = trees._tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
                s.lookahead -= s.match_length;
                if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
                  s.match_length--;
                  do {
                    s.strstart++;
                    s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                    hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                    s.head[s.ins_h] = s.strstart;
                  } while (--s.match_length !== 0);
                  s.strstart++;
                } else {
                  s.strstart += s.match_length;
                  s.match_length = 0;
                  s.ins_h = s.window[s.strstart];
                  s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + 1]) & s.hash_mask;
                }
              } else {
                bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
                s.lookahead--;
                s.strstart++;
              }
              if (bflush) {
                flush_block_only(s, false);
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              }
            }
            s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
            if (flush === Z_FINISH) {
              flush_block_only(s, true);
              if (s.strm.avail_out === 0) {
                return BS_FINISH_STARTED;
              }
              return BS_FINISH_DONE;
            }
            if (s.last_lit) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
            return BS_BLOCK_DONE;
          }
          function deflate_slow(s, flush) {
            var hash_head;
            var bflush;
            var max_insert;
            for (; ; ) {
              if (s.lookahead < MIN_LOOKAHEAD) {
                fill_window(s);
                if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
                  return BS_NEED_MORE;
                }
                if (s.lookahead === 0) {
                  break;
                }
              }
              hash_head = 0;
              if (s.lookahead >= MIN_MATCH) {
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                s.head[s.ins_h] = s.strstart;
              }
              s.prev_length = s.match_length;
              s.prev_match = s.match_start;
              s.match_length = MIN_MATCH - 1;
              if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
                s.match_length = longest_match(s, hash_head);
                if (s.match_length <= 5 && (s.strategy === Z_FILTERED || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) {
                  s.match_length = MIN_MATCH - 1;
                }
              }
              if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
                max_insert = s.strstart + s.lookahead - MIN_MATCH;
                bflush = trees._tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
                s.lookahead -= s.prev_length - 1;
                s.prev_length -= 2;
                do {
                  if (++s.strstart <= max_insert) {
                    s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                    hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                    s.head[s.ins_h] = s.strstart;
                  }
                } while (--s.prev_length !== 0);
                s.match_available = 0;
                s.match_length = MIN_MATCH - 1;
                s.strstart++;
                if (bflush) {
                  flush_block_only(s, false);
                  if (s.strm.avail_out === 0) {
                    return BS_NEED_MORE;
                  }
                }
              } else if (s.match_available) {
                bflush = trees._tr_tally(s, 0, s.window[s.strstart - 1]);
                if (bflush) {
                  flush_block_only(s, false);
                }
                s.strstart++;
                s.lookahead--;
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              } else {
                s.match_available = 1;
                s.strstart++;
                s.lookahead--;
              }
            }
            if (s.match_available) {
              bflush = trees._tr_tally(s, 0, s.window[s.strstart - 1]);
              s.match_available = 0;
            }
            s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
            if (flush === Z_FINISH) {
              flush_block_only(s, true);
              if (s.strm.avail_out === 0) {
                return BS_FINISH_STARTED;
              }
              return BS_FINISH_DONE;
            }
            if (s.last_lit) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
            return BS_BLOCK_DONE;
          }
          function deflate_rle(s, flush) {
            var bflush;
            var prev;
            var scan, strend;
            var _win = s.window;
            for (; ; ) {
              if (s.lookahead <= MAX_MATCH) {
                fill_window(s);
                if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
                  return BS_NEED_MORE;
                }
                if (s.lookahead === 0) {
                  break;
                }
              }
              s.match_length = 0;
              if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
                scan = s.strstart - 1;
                prev = _win[scan];
                if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
                  strend = s.strstart + MAX_MATCH;
                  do {
                  } while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);
                  s.match_length = MAX_MATCH - (strend - scan);
                  if (s.match_length > s.lookahead) {
                    s.match_length = s.lookahead;
                  }
                }
              }
              if (s.match_length >= MIN_MATCH) {
                bflush = trees._tr_tally(s, 1, s.match_length - MIN_MATCH);
                s.lookahead -= s.match_length;
                s.strstart += s.match_length;
                s.match_length = 0;
              } else {
                bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
                s.lookahead--;
                s.strstart++;
              }
              if (bflush) {
                flush_block_only(s, false);
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              }
            }
            s.insert = 0;
            if (flush === Z_FINISH) {
              flush_block_only(s, true);
              if (s.strm.avail_out === 0) {
                return BS_FINISH_STARTED;
              }
              return BS_FINISH_DONE;
            }
            if (s.last_lit) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
            return BS_BLOCK_DONE;
          }
          function deflate_huff(s, flush) {
            var bflush;
            for (; ; ) {
              if (s.lookahead === 0) {
                fill_window(s);
                if (s.lookahead === 0) {
                  if (flush === Z_NO_FLUSH) {
                    return BS_NEED_MORE;
                  }
                  break;
                }
              }
              s.match_length = 0;
              bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
              s.lookahead--;
              s.strstart++;
              if (bflush) {
                flush_block_only(s, false);
                if (s.strm.avail_out === 0) {
                  return BS_NEED_MORE;
                }
              }
            }
            s.insert = 0;
            if (flush === Z_FINISH) {
              flush_block_only(s, true);
              if (s.strm.avail_out === 0) {
                return BS_FINISH_STARTED;
              }
              return BS_FINISH_DONE;
            }
            if (s.last_lit) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
            return BS_BLOCK_DONE;
          }
          function Config(good_length, max_lazy, nice_length, max_chain, func) {
            this.good_length = good_length;
            this.max_lazy = max_lazy;
            this.nice_length = nice_length;
            this.max_chain = max_chain;
            this.func = func;
          }
          var configuration_table;
          configuration_table = [
            /*      good lazy nice chain */
            new Config(0, 0, 0, 0, deflate_stored),
            /* 0 store only */
            new Config(4, 4, 8, 4, deflate_fast),
            /* 1 max speed, no lazy matches */
            new Config(4, 5, 16, 8, deflate_fast),
            /* 2 */
            new Config(4, 6, 32, 32, deflate_fast),
            /* 3 */
            new Config(4, 4, 16, 16, deflate_slow),
            /* 4 lazy matches */
            new Config(8, 16, 32, 32, deflate_slow),
            /* 5 */
            new Config(8, 16, 128, 128, deflate_slow),
            /* 6 */
            new Config(8, 32, 128, 256, deflate_slow),
            /* 7 */
            new Config(32, 128, 258, 1024, deflate_slow),
            /* 8 */
            new Config(32, 258, 258, 4096, deflate_slow)
            /* 9 max compression */
          ];
          function lm_init(s) {
            s.window_size = 2 * s.w_size;
            zero(s.head);
            s.max_lazy_match = configuration_table[s.level].max_lazy;
            s.good_match = configuration_table[s.level].good_length;
            s.nice_match = configuration_table[s.level].nice_length;
            s.max_chain_length = configuration_table[s.level].max_chain;
            s.strstart = 0;
            s.block_start = 0;
            s.lookahead = 0;
            s.insert = 0;
            s.match_length = s.prev_length = MIN_MATCH - 1;
            s.match_available = 0;
            s.ins_h = 0;
          }
          function DeflateState() {
            this.strm = null;
            this.status = 0;
            this.pending_buf = null;
            this.pending_buf_size = 0;
            this.pending_out = 0;
            this.pending = 0;
            this.wrap = 0;
            this.gzhead = null;
            this.gzindex = 0;
            this.method = Z_DEFLATED;
            this.last_flush = -1;
            this.w_size = 0;
            this.w_bits = 0;
            this.w_mask = 0;
            this.window = null;
            this.window_size = 0;
            this.prev = null;
            this.head = null;
            this.ins_h = 0;
            this.hash_size = 0;
            this.hash_bits = 0;
            this.hash_mask = 0;
            this.hash_shift = 0;
            this.block_start = 0;
            this.match_length = 0;
            this.prev_match = 0;
            this.match_available = 0;
            this.strstart = 0;
            this.match_start = 0;
            this.lookahead = 0;
            this.prev_length = 0;
            this.max_chain_length = 0;
            this.max_lazy_match = 0;
            this.level = 0;
            this.strategy = 0;
            this.good_match = 0;
            this.nice_match = 0;
            this.dyn_ltree = new utils.Buf16(HEAP_SIZE * 2);
            this.dyn_dtree = new utils.Buf16((2 * D_CODES + 1) * 2);
            this.bl_tree = new utils.Buf16((2 * BL_CODES + 1) * 2);
            zero(this.dyn_ltree);
            zero(this.dyn_dtree);
            zero(this.bl_tree);
            this.l_desc = null;
            this.d_desc = null;
            this.bl_desc = null;
            this.bl_count = new utils.Buf16(MAX_BITS + 1);
            this.heap = new utils.Buf16(2 * L_CODES + 1);
            zero(this.heap);
            this.heap_len = 0;
            this.heap_max = 0;
            this.depth = new utils.Buf16(2 * L_CODES + 1);
            zero(this.depth);
            this.l_buf = 0;
            this.lit_bufsize = 0;
            this.last_lit = 0;
            this.d_buf = 0;
            this.opt_len = 0;
            this.static_len = 0;
            this.matches = 0;
            this.insert = 0;
            this.bi_buf = 0;
            this.bi_valid = 0;
          }
          function deflateResetKeep(strm) {
            var s;
            if (!strm || !strm.state) {
              return err(strm, Z_STREAM_ERROR);
            }
            strm.total_in = strm.total_out = 0;
            strm.data_type = Z_UNKNOWN;
            s = strm.state;
            s.pending = 0;
            s.pending_out = 0;
            if (s.wrap < 0) {
              s.wrap = -s.wrap;
            }
            s.status = s.wrap ? INIT_STATE : BUSY_STATE;
            strm.adler = s.wrap === 2 ? 0 : 1;
            s.last_flush = Z_NO_FLUSH;
            trees._tr_init(s);
            return Z_OK;
          }
          function deflateReset(strm) {
            var ret = deflateResetKeep(strm);
            if (ret === Z_OK) {
              lm_init(strm.state);
            }
            return ret;
          }
          function deflateSetHeader(strm, head) {
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            if (strm.state.wrap !== 2) {
              return Z_STREAM_ERROR;
            }
            strm.state.gzhead = head;
            return Z_OK;
          }
          function deflateInit2(strm, level, method, windowBits, memLevel, strategy) {
            if (!strm) {
              return Z_STREAM_ERROR;
            }
            var wrap = 1;
            if (level === Z_DEFAULT_COMPRESSION) {
              level = 6;
            }
            if (windowBits < 0) {
              wrap = 0;
              windowBits = -windowBits;
            } else if (windowBits > 15) {
              wrap = 2;
              windowBits -= 16;
            }
            if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > Z_FIXED) {
              return err(strm, Z_STREAM_ERROR);
            }
            if (windowBits === 8) {
              windowBits = 9;
            }
            var s = new DeflateState();
            strm.state = s;
            s.strm = strm;
            s.wrap = wrap;
            s.gzhead = null;
            s.w_bits = windowBits;
            s.w_size = 1 << s.w_bits;
            s.w_mask = s.w_size - 1;
            s.hash_bits = memLevel + 7;
            s.hash_size = 1 << s.hash_bits;
            s.hash_mask = s.hash_size - 1;
            s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);
            s.window = new utils.Buf8(s.w_size * 2);
            s.head = new utils.Buf16(s.hash_size);
            s.prev = new utils.Buf16(s.w_size);
            s.lit_bufsize = 1 << memLevel + 6;
            s.pending_buf_size = s.lit_bufsize * 4;
            s.pending_buf = new utils.Buf8(s.pending_buf_size);
            s.d_buf = 1 * s.lit_bufsize;
            s.l_buf = (1 + 2) * s.lit_bufsize;
            s.level = level;
            s.strategy = strategy;
            s.method = method;
            return deflateReset(strm);
          }
          function deflateInit(strm, level) {
            return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
          }
          function deflate(strm, flush) {
            var old_flush, s;
            var beg, val2;
            if (!strm || !strm.state || flush > Z_BLOCK || flush < 0) {
              return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
            }
            s = strm.state;
            if (!strm.output || !strm.input && strm.avail_in !== 0 || s.status === FINISH_STATE && flush !== Z_FINISH) {
              return err(strm, strm.avail_out === 0 ? Z_BUF_ERROR : Z_STREAM_ERROR);
            }
            s.strm = strm;
            old_flush = s.last_flush;
            s.last_flush = flush;
            if (s.status === INIT_STATE) {
              if (s.wrap === 2) {
                strm.adler = 0;
                put_byte(s, 31);
                put_byte(s, 139);
                put_byte(s, 8);
                if (!s.gzhead) {
                  put_byte(s, 0);
                  put_byte(s, 0);
                  put_byte(s, 0);
                  put_byte(s, 0);
                  put_byte(s, 0);
                  put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
                  put_byte(s, OS_CODE);
                  s.status = BUSY_STATE;
                } else {
                  put_byte(
                    s,
                    (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16)
                  );
                  put_byte(s, s.gzhead.time & 255);
                  put_byte(s, s.gzhead.time >> 8 & 255);
                  put_byte(s, s.gzhead.time >> 16 & 255);
                  put_byte(s, s.gzhead.time >> 24 & 255);
                  put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
                  put_byte(s, s.gzhead.os & 255);
                  if (s.gzhead.extra && s.gzhead.extra.length) {
                    put_byte(s, s.gzhead.extra.length & 255);
                    put_byte(s, s.gzhead.extra.length >> 8 & 255);
                  }
                  if (s.gzhead.hcrc) {
                    strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
                  }
                  s.gzindex = 0;
                  s.status = EXTRA_STATE;
                }
              } else {
                var header = Z_DEFLATED + (s.w_bits - 8 << 4) << 8;
                var level_flags = -1;
                if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
                  level_flags = 0;
                } else if (s.level < 6) {
                  level_flags = 1;
                } else if (s.level === 6) {
                  level_flags = 2;
                } else {
                  level_flags = 3;
                }
                header |= level_flags << 6;
                if (s.strstart !== 0) {
                  header |= PRESET_DICT;
                }
                header += 31 - header % 31;
                s.status = BUSY_STATE;
                putShortMSB(s, header);
                if (s.strstart !== 0) {
                  putShortMSB(s, strm.adler >>> 16);
                  putShortMSB(s, strm.adler & 65535);
                }
                strm.adler = 1;
              }
            }
            if (s.status === EXTRA_STATE) {
              if (s.gzhead.extra) {
                beg = s.pending;
                while (s.gzindex < (s.gzhead.extra.length & 65535)) {
                  if (s.pending === s.pending_buf_size) {
                    if (s.gzhead.hcrc && s.pending > beg) {
                      strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                    }
                    flush_pending(strm);
                    beg = s.pending;
                    if (s.pending === s.pending_buf_size) {
                      break;
                    }
                  }
                  put_byte(s, s.gzhead.extra[s.gzindex] & 255);
                  s.gzindex++;
                }
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                }
                if (s.gzindex === s.gzhead.extra.length) {
                  s.gzindex = 0;
                  s.status = NAME_STATE;
                }
              } else {
                s.status = NAME_STATE;
              }
            }
            if (s.status === NAME_STATE) {
              if (s.gzhead.name) {
                beg = s.pending;
                do {
                  if (s.pending === s.pending_buf_size) {
                    if (s.gzhead.hcrc && s.pending > beg) {
                      strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                    }
                    flush_pending(strm);
                    beg = s.pending;
                    if (s.pending === s.pending_buf_size) {
                      val2 = 1;
                      break;
                    }
                  }
                  if (s.gzindex < s.gzhead.name.length) {
                    val2 = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
                  } else {
                    val2 = 0;
                  }
                  put_byte(s, val2);
                } while (val2 !== 0);
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                }
                if (val2 === 0) {
                  s.gzindex = 0;
                  s.status = COMMENT_STATE;
                }
              } else {
                s.status = COMMENT_STATE;
              }
            }
            if (s.status === COMMENT_STATE) {
              if (s.gzhead.comment) {
                beg = s.pending;
                do {
                  if (s.pending === s.pending_buf_size) {
                    if (s.gzhead.hcrc && s.pending > beg) {
                      strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                    }
                    flush_pending(strm);
                    beg = s.pending;
                    if (s.pending === s.pending_buf_size) {
                      val2 = 1;
                      break;
                    }
                  }
                  if (s.gzindex < s.gzhead.comment.length) {
                    val2 = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
                  } else {
                    val2 = 0;
                  }
                  put_byte(s, val2);
                } while (val2 !== 0);
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
                }
                if (val2 === 0) {
                  s.status = HCRC_STATE;
                }
              } else {
                s.status = HCRC_STATE;
              }
            }
            if (s.status === HCRC_STATE) {
              if (s.gzhead.hcrc) {
                if (s.pending + 2 > s.pending_buf_size) {
                  flush_pending(strm);
                }
                if (s.pending + 2 <= s.pending_buf_size) {
                  put_byte(s, strm.adler & 255);
                  put_byte(s, strm.adler >> 8 & 255);
                  strm.adler = 0;
                  s.status = BUSY_STATE;
                }
              } else {
                s.status = BUSY_STATE;
              }
            }
            if (s.pending !== 0) {
              flush_pending(strm);
              if (strm.avail_out === 0) {
                s.last_flush = -1;
                return Z_OK;
              }
            } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== Z_FINISH) {
              return err(strm, Z_BUF_ERROR);
            }
            if (s.status === FINISH_STATE && strm.avail_in !== 0) {
              return err(strm, Z_BUF_ERROR);
            }
            if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== Z_NO_FLUSH && s.status !== FINISH_STATE) {
              var bstate = s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) : s.strategy === Z_RLE ? deflate_rle(s, flush) : configuration_table[s.level].func(s, flush);
              if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
                s.status = FINISH_STATE;
              }
              if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
                if (strm.avail_out === 0) {
                  s.last_flush = -1;
                }
                return Z_OK;
              }
              if (bstate === BS_BLOCK_DONE) {
                if (flush === Z_PARTIAL_FLUSH) {
                  trees._tr_align(s);
                } else if (flush !== Z_BLOCK) {
                  trees._tr_stored_block(s, 0, 0, false);
                  if (flush === Z_FULL_FLUSH) {
                    zero(s.head);
                    if (s.lookahead === 0) {
                      s.strstart = 0;
                      s.block_start = 0;
                      s.insert = 0;
                    }
                  }
                }
                flush_pending(strm);
                if (strm.avail_out === 0) {
                  s.last_flush = -1;
                  return Z_OK;
                }
              }
            }
            if (flush !== Z_FINISH) {
              return Z_OK;
            }
            if (s.wrap <= 0) {
              return Z_STREAM_END;
            }
            if (s.wrap === 2) {
              put_byte(s, strm.adler & 255);
              put_byte(s, strm.adler >> 8 & 255);
              put_byte(s, strm.adler >> 16 & 255);
              put_byte(s, strm.adler >> 24 & 255);
              put_byte(s, strm.total_in & 255);
              put_byte(s, strm.total_in >> 8 & 255);
              put_byte(s, strm.total_in >> 16 & 255);
              put_byte(s, strm.total_in >> 24 & 255);
            } else {
              putShortMSB(s, strm.adler >>> 16);
              putShortMSB(s, strm.adler & 65535);
            }
            flush_pending(strm);
            if (s.wrap > 0) {
              s.wrap = -s.wrap;
            }
            return s.pending !== 0 ? Z_OK : Z_STREAM_END;
          }
          function deflateEnd(strm) {
            var status;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            status = strm.state.status;
            if (status !== INIT_STATE && status !== EXTRA_STATE && status !== NAME_STATE && status !== COMMENT_STATE && status !== HCRC_STATE && status !== BUSY_STATE && status !== FINISH_STATE) {
              return err(strm, Z_STREAM_ERROR);
            }
            strm.state = null;
            return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
          }
          function deflateSetDictionary(strm, dictionary) {
            var dictLength = dictionary.length;
            var s;
            var str, n;
            var wrap;
            var avail;
            var next;
            var input;
            var tmpDict;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            s = strm.state;
            wrap = s.wrap;
            if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) {
              return Z_STREAM_ERROR;
            }
            if (wrap === 1) {
              strm.adler = adler32(strm.adler, dictionary, dictLength, 0);
            }
            s.wrap = 0;
            if (dictLength >= s.w_size) {
              if (wrap === 0) {
                zero(s.head);
                s.strstart = 0;
                s.block_start = 0;
                s.insert = 0;
              }
              tmpDict = new utils.Buf8(s.w_size);
              utils.arraySet(tmpDict, dictionary, dictLength - s.w_size, s.w_size, 0);
              dictionary = tmpDict;
              dictLength = s.w_size;
            }
            avail = strm.avail_in;
            next = strm.next_in;
            input = strm.input;
            strm.avail_in = dictLength;
            strm.next_in = 0;
            strm.input = dictionary;
            fill_window(s);
            while (s.lookahead >= MIN_MATCH) {
              str = s.strstart;
              n = s.lookahead - (MIN_MATCH - 1);
              do {
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + MIN_MATCH - 1]) & s.hash_mask;
                s.prev[str & s.w_mask] = s.head[s.ins_h];
                s.head[s.ins_h] = str;
                str++;
              } while (--n);
              s.strstart = str;
              s.lookahead = MIN_MATCH - 1;
              fill_window(s);
            }
            s.strstart += s.lookahead;
            s.block_start = s.strstart;
            s.insert = s.lookahead;
            s.lookahead = 0;
            s.match_length = s.prev_length = MIN_MATCH - 1;
            s.match_available = 0;
            strm.next_in = next;
            strm.input = input;
            strm.avail_in = avail;
            s.wrap = wrap;
            return Z_OK;
          }
          exports3.deflateInit = deflateInit;
          exports3.deflateInit2 = deflateInit2;
          exports3.deflateReset = deflateReset;
          exports3.deflateResetKeep = deflateResetKeep;
          exports3.deflateSetHeader = deflateSetHeader;
          exports3.deflate = deflate;
          exports3.deflateEnd = deflateEnd;
          exports3.deflateSetDictionary = deflateSetDictionary;
          exports3.deflateInfo = "pako deflate (from Nodeca project)";
        }, { "../utils/common": 52, "./adler32": 53, "./crc32": 55, "./messages": 60, "./trees": 61 }], 57: [function(require2, module3, exports3) {
          "use strict";
          var BAD = 30;
          var TYPE = 12;
          module3.exports = function inflate_fast(strm, start) {
            var state;
            var _in;
            var last;
            var _out;
            var beg;
            var end;
            var dmax;
            var wsize;
            var whave;
            var wnext;
            var s_window;
            var hold;
            var bits;
            var lcode;
            var dcode;
            var lmask;
            var dmask;
            var here;
            var op;
            var len;
            var dist;
            var from;
            var from_source;
            var input, output;
            state = strm.state;
            _in = strm.next_in;
            input = strm.input;
            last = _in + (strm.avail_in - 5);
            _out = strm.next_out;
            output = strm.output;
            beg = _out - (start - strm.avail_out);
            end = _out + (strm.avail_out - 257);
            dmax = state.dmax;
            wsize = state.wsize;
            whave = state.whave;
            wnext = state.wnext;
            s_window = state.window;
            hold = state.hold;
            bits = state.bits;
            lcode = state.lencode;
            dcode = state.distcode;
            lmask = (1 << state.lenbits) - 1;
            dmask = (1 << state.distbits) - 1;
            top:
              do {
                if (bits < 15) {
                  hold += input[_in++] << bits;
                  bits += 8;
                  hold += input[_in++] << bits;
                  bits += 8;
                }
                here = lcode[hold & lmask];
                dolen:
                  for (; ; ) {
                    op = here >>> 24;
                    hold >>>= op;
                    bits -= op;
                    op = here >>> 16 & 255;
                    if (op === 0) {
                      output[_out++] = here & 65535;
                    } else if (op & 16) {
                      len = here & 65535;
                      op &= 15;
                      if (op) {
                        if (bits < op) {
                          hold += input[_in++] << bits;
                          bits += 8;
                        }
                        len += hold & (1 << op) - 1;
                        hold >>>= op;
                        bits -= op;
                      }
                      if (bits < 15) {
                        hold += input[_in++] << bits;
                        bits += 8;
                        hold += input[_in++] << bits;
                        bits += 8;
                      }
                      here = dcode[hold & dmask];
                      dodist:
                        for (; ; ) {
                          op = here >>> 24;
                          hold >>>= op;
                          bits -= op;
                          op = here >>> 16 & 255;
                          if (op & 16) {
                            dist = here & 65535;
                            op &= 15;
                            if (bits < op) {
                              hold += input[_in++] << bits;
                              bits += 8;
                              if (bits < op) {
                                hold += input[_in++] << bits;
                                bits += 8;
                              }
                            }
                            dist += hold & (1 << op) - 1;
                            if (dist > dmax) {
                              strm.msg = "invalid distance too far back";
                              state.mode = BAD;
                              break top;
                            }
                            hold >>>= op;
                            bits -= op;
                            op = _out - beg;
                            if (dist > op) {
                              op = dist - op;
                              if (op > whave) {
                                if (state.sane) {
                                  strm.msg = "invalid distance too far back";
                                  state.mode = BAD;
                                  break top;
                                }
                              }
                              from = 0;
                              from_source = s_window;
                              if (wnext === 0) {
                                from += wsize - op;
                                if (op < len) {
                                  len -= op;
                                  do {
                                    output[_out++] = s_window[from++];
                                  } while (--op);
                                  from = _out - dist;
                                  from_source = output;
                                }
                              } else if (wnext < op) {
                                from += wsize + wnext - op;
                                op -= wnext;
                                if (op < len) {
                                  len -= op;
                                  do {
                                    output[_out++] = s_window[from++];
                                  } while (--op);
                                  from = 0;
                                  if (wnext < len) {
                                    op = wnext;
                                    len -= op;
                                    do {
                                      output[_out++] = s_window[from++];
                                    } while (--op);
                                    from = _out - dist;
                                    from_source = output;
                                  }
                                }
                              } else {
                                from += wnext - op;
                                if (op < len) {
                                  len -= op;
                                  do {
                                    output[_out++] = s_window[from++];
                                  } while (--op);
                                  from = _out - dist;
                                  from_source = output;
                                }
                              }
                              while (len > 2) {
                                output[_out++] = from_source[from++];
                                output[_out++] = from_source[from++];
                                output[_out++] = from_source[from++];
                                len -= 3;
                              }
                              if (len) {
                                output[_out++] = from_source[from++];
                                if (len > 1) {
                                  output[_out++] = from_source[from++];
                                }
                              }
                            } else {
                              from = _out - dist;
                              do {
                                output[_out++] = output[from++];
                                output[_out++] = output[from++];
                                output[_out++] = output[from++];
                                len -= 3;
                              } while (len > 2);
                              if (len) {
                                output[_out++] = output[from++];
                                if (len > 1) {
                                  output[_out++] = output[from++];
                                }
                              }
                            }
                          } else if ((op & 64) === 0) {
                            here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                            continue dodist;
                          } else {
                            strm.msg = "invalid distance code";
                            state.mode = BAD;
                            break top;
                          }
                          break;
                        }
                    } else if ((op & 64) === 0) {
                      here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
                      continue dolen;
                    } else if (op & 32) {
                      state.mode = TYPE;
                      break top;
                    } else {
                      strm.msg = "invalid literal/length code";
                      state.mode = BAD;
                      break top;
                    }
                    break;
                  }
              } while (_in < last && _out < end);
            len = bits >> 3;
            _in -= len;
            bits -= len << 3;
            hold &= (1 << bits) - 1;
            strm.next_in = _in;
            strm.next_out = _out;
            strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
            strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
            state.hold = hold;
            state.bits = bits;
            return;
          };
        }, {}], 58: [function(require2, module3, exports3) {
          "use strict";
          var utils = require2("../utils/common");
          var adler32 = require2("./adler32");
          var crc32 = require2("./crc32");
          var inflate_fast = require2("./inffast");
          var inflate_table = require2("./inftrees");
          var CODES = 0;
          var LENS = 1;
          var DISTS = 2;
          var Z_FINISH = 4;
          var Z_BLOCK = 5;
          var Z_TREES = 6;
          var Z_OK = 0;
          var Z_STREAM_END = 1;
          var Z_NEED_DICT = 2;
          var Z_STREAM_ERROR = -2;
          var Z_DATA_ERROR = -3;
          var Z_MEM_ERROR = -4;
          var Z_BUF_ERROR = -5;
          var Z_DEFLATED = 8;
          var HEAD = 1;
          var FLAGS = 2;
          var TIME = 3;
          var OS = 4;
          var EXLEN = 5;
          var EXTRA = 6;
          var NAME = 7;
          var COMMENT = 8;
          var HCRC = 9;
          var DICTID = 10;
          var DICT = 11;
          var TYPE = 12;
          var TYPEDO = 13;
          var STORED = 14;
          var COPY_ = 15;
          var COPY = 16;
          var TABLE = 17;
          var LENLENS = 18;
          var CODELENS = 19;
          var LEN_ = 20;
          var LEN = 21;
          var LENEXT = 22;
          var DIST = 23;
          var DISTEXT = 24;
          var MATCH = 25;
          var LIT = 26;
          var CHECK = 27;
          var LENGTH = 28;
          var DONE = 29;
          var BAD = 30;
          var MEM = 31;
          var SYNC = 32;
          var ENOUGH_LENS = 852;
          var ENOUGH_DISTS = 592;
          var MAX_WBITS = 15;
          var DEF_WBITS = MAX_WBITS;
          function zswap32(q) {
            return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
          }
          function InflateState() {
            this.mode = 0;
            this.last = false;
            this.wrap = 0;
            this.havedict = false;
            this.flags = 0;
            this.dmax = 0;
            this.check = 0;
            this.total = 0;
            this.head = null;
            this.wbits = 0;
            this.wsize = 0;
            this.whave = 0;
            this.wnext = 0;
            this.window = null;
            this.hold = 0;
            this.bits = 0;
            this.length = 0;
            this.offset = 0;
            this.extra = 0;
            this.lencode = null;
            this.distcode = null;
            this.lenbits = 0;
            this.distbits = 0;
            this.ncode = 0;
            this.nlen = 0;
            this.ndist = 0;
            this.have = 0;
            this.next = null;
            this.lens = new utils.Buf16(320);
            this.work = new utils.Buf16(288);
            this.lendyn = null;
            this.distdyn = null;
            this.sane = 0;
            this.back = 0;
            this.was = 0;
          }
          function inflateResetKeep(strm) {
            var state;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            strm.total_in = strm.total_out = state.total = 0;
            strm.msg = "";
            if (state.wrap) {
              strm.adler = state.wrap & 1;
            }
            state.mode = HEAD;
            state.last = 0;
            state.havedict = 0;
            state.dmax = 32768;
            state.head = null;
            state.hold = 0;
            state.bits = 0;
            state.lencode = state.lendyn = new utils.Buf32(ENOUGH_LENS);
            state.distcode = state.distdyn = new utils.Buf32(ENOUGH_DISTS);
            state.sane = 1;
            state.back = -1;
            return Z_OK;
          }
          function inflateReset(strm) {
            var state;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            state.wsize = 0;
            state.whave = 0;
            state.wnext = 0;
            return inflateResetKeep(strm);
          }
          function inflateReset2(strm, windowBits) {
            var wrap;
            var state;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            if (windowBits < 0) {
              wrap = 0;
              windowBits = -windowBits;
            } else {
              wrap = (windowBits >> 4) + 1;
              if (windowBits < 48) {
                windowBits &= 15;
              }
            }
            if (windowBits && (windowBits < 8 || windowBits > 15)) {
              return Z_STREAM_ERROR;
            }
            if (state.window !== null && state.wbits !== windowBits) {
              state.window = null;
            }
            state.wrap = wrap;
            state.wbits = windowBits;
            return inflateReset(strm);
          }
          function inflateInit2(strm, windowBits) {
            var ret;
            var state;
            if (!strm) {
              return Z_STREAM_ERROR;
            }
            state = new InflateState();
            strm.state = state;
            state.window = null;
            ret = inflateReset2(strm, windowBits);
            if (ret !== Z_OK) {
              strm.state = null;
            }
            return ret;
          }
          function inflateInit(strm) {
            return inflateInit2(strm, DEF_WBITS);
          }
          var virgin = true;
          var lenfix, distfix;
          function fixedtables(state) {
            if (virgin) {
              var sym;
              lenfix = new utils.Buf32(512);
              distfix = new utils.Buf32(32);
              sym = 0;
              while (sym < 144) {
                state.lens[sym++] = 8;
              }
              while (sym < 256) {
                state.lens[sym++] = 9;
              }
              while (sym < 280) {
                state.lens[sym++] = 7;
              }
              while (sym < 288) {
                state.lens[sym++] = 8;
              }
              inflate_table(LENS, state.lens, 0, 288, lenfix, 0, state.work, { bits: 9 });
              sym = 0;
              while (sym < 32) {
                state.lens[sym++] = 5;
              }
              inflate_table(DISTS, state.lens, 0, 32, distfix, 0, state.work, { bits: 5 });
              virgin = false;
            }
            state.lencode = lenfix;
            state.lenbits = 9;
            state.distcode = distfix;
            state.distbits = 5;
          }
          function updatewindow(strm, src, end, copy) {
            var dist;
            var state = strm.state;
            if (state.window === null) {
              state.wsize = 1 << state.wbits;
              state.wnext = 0;
              state.whave = 0;
              state.window = new utils.Buf8(state.wsize);
            }
            if (copy >= state.wsize) {
              utils.arraySet(state.window, src, end - state.wsize, state.wsize, 0);
              state.wnext = 0;
              state.whave = state.wsize;
            } else {
              dist = state.wsize - state.wnext;
              if (dist > copy) {
                dist = copy;
              }
              utils.arraySet(state.window, src, end - copy, dist, state.wnext);
              copy -= dist;
              if (copy) {
                utils.arraySet(state.window, src, end - copy, copy, 0);
                state.wnext = copy;
                state.whave = state.wsize;
              } else {
                state.wnext += dist;
                if (state.wnext === state.wsize) {
                  state.wnext = 0;
                }
                if (state.whave < state.wsize) {
                  state.whave += dist;
                }
              }
            }
            return 0;
          }
          function inflate(strm, flush) {
            var state;
            var input, output;
            var next;
            var put;
            var have, left;
            var hold;
            var bits;
            var _in, _out;
            var copy;
            var from;
            var from_source;
            var here = 0;
            var here_bits, here_op, here_val;
            var last_bits, last_op, last_val;
            var len;
            var ret;
            var hbuf = new utils.Buf8(4);
            var opts;
            var n;
            var order = (
              /* permutation of code lengths */
              [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
            );
            if (!strm || !strm.state || !strm.output || !strm.input && strm.avail_in !== 0) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            if (state.mode === TYPE) {
              state.mode = TYPEDO;
            }
            put = strm.next_out;
            output = strm.output;
            left = strm.avail_out;
            next = strm.next_in;
            input = strm.input;
            have = strm.avail_in;
            hold = state.hold;
            bits = state.bits;
            _in = have;
            _out = left;
            ret = Z_OK;
            inf_leave:
              for (; ; ) {
                switch (state.mode) {
                  case HEAD:
                    if (state.wrap === 0) {
                      state.mode = TYPEDO;
                      break;
                    }
                    while (bits < 16) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if (state.wrap & 2 && hold === 35615) {
                      state.check = 0;
                      hbuf[0] = hold & 255;
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                      hold = 0;
                      bits = 0;
                      state.mode = FLAGS;
                      break;
                    }
                    state.flags = 0;
                    if (state.head) {
                      state.head.done = false;
                    }
                    if (!(state.wrap & 1) || /* check if zlib header allowed */
                    (((hold & 255) << 8) + (hold >> 8)) % 31) {
                      strm.msg = "incorrect header check";
                      state.mode = BAD;
                      break;
                    }
                    if ((hold & 15) !== Z_DEFLATED) {
                      strm.msg = "unknown compression method";
                      state.mode = BAD;
                      break;
                    }
                    hold >>>= 4;
                    bits -= 4;
                    len = (hold & 15) + 8;
                    if (state.wbits === 0) {
                      state.wbits = len;
                    } else if (len > state.wbits) {
                      strm.msg = "invalid window size";
                      state.mode = BAD;
                      break;
                    }
                    state.dmax = 1 << len;
                    strm.adler = state.check = 1;
                    state.mode = hold & 512 ? DICTID : TYPE;
                    hold = 0;
                    bits = 0;
                    break;
                  case FLAGS:
                    while (bits < 16) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    state.flags = hold;
                    if ((state.flags & 255) !== Z_DEFLATED) {
                      strm.msg = "unknown compression method";
                      state.mode = BAD;
                      break;
                    }
                    if (state.flags & 57344) {
                      strm.msg = "unknown header flags set";
                      state.mode = BAD;
                      break;
                    }
                    if (state.head) {
                      state.head.text = hold >> 8 & 1;
                    }
                    if (state.flags & 512) {
                      hbuf[0] = hold & 255;
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                    }
                    hold = 0;
                    bits = 0;
                    state.mode = TIME;
                  case TIME:
                    while (bits < 32) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if (state.head) {
                      state.head.time = hold;
                    }
                    if (state.flags & 512) {
                      hbuf[0] = hold & 255;
                      hbuf[1] = hold >>> 8 & 255;
                      hbuf[2] = hold >>> 16 & 255;
                      hbuf[3] = hold >>> 24 & 255;
                      state.check = crc32(state.check, hbuf, 4, 0);
                    }
                    hold = 0;
                    bits = 0;
                    state.mode = OS;
                  case OS:
                    while (bits < 16) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if (state.head) {
                      state.head.xflags = hold & 255;
                      state.head.os = hold >> 8;
                    }
                    if (state.flags & 512) {
                      hbuf[0] = hold & 255;
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                    }
                    hold = 0;
                    bits = 0;
                    state.mode = EXLEN;
                  case EXLEN:
                    if (state.flags & 1024) {
                      while (bits < 16) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      state.length = hold;
                      if (state.head) {
                        state.head.extra_len = hold;
                      }
                      if (state.flags & 512) {
                        hbuf[0] = hold & 255;
                        hbuf[1] = hold >>> 8 & 255;
                        state.check = crc32(state.check, hbuf, 2, 0);
                      }
                      hold = 0;
                      bits = 0;
                    } else if (state.head) {
                      state.head.extra = null;
                    }
                    state.mode = EXTRA;
                  case EXTRA:
                    if (state.flags & 1024) {
                      copy = state.length;
                      if (copy > have) {
                        copy = have;
                      }
                      if (copy) {
                        if (state.head) {
                          len = state.head.extra_len - state.length;
                          if (!state.head.extra) {
                            state.head.extra = new Array(state.head.extra_len);
                          }
                          utils.arraySet(
                            state.head.extra,
                            input,
                            next,
                            // extra field is limited to 65536 bytes
                            // - no need for additional size check
                            copy,
                            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                            len
                          );
                        }
                        if (state.flags & 512) {
                          state.check = crc32(state.check, input, copy, next);
                        }
                        have -= copy;
                        next += copy;
                        state.length -= copy;
                      }
                      if (state.length) {
                        break inf_leave;
                      }
                    }
                    state.length = 0;
                    state.mode = NAME;
                  case NAME:
                    if (state.flags & 2048) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      copy = 0;
                      do {
                        len = input[next + copy++];
                        if (state.head && len && state.length < 65536) {
                          state.head.name += String.fromCharCode(len);
                        }
                      } while (len && copy < have);
                      if (state.flags & 512) {
                        state.check = crc32(state.check, input, copy, next);
                      }
                      have -= copy;
                      next += copy;
                      if (len) {
                        break inf_leave;
                      }
                    } else if (state.head) {
                      state.head.name = null;
                    }
                    state.length = 0;
                    state.mode = COMMENT;
                  case COMMENT:
                    if (state.flags & 4096) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      copy = 0;
                      do {
                        len = input[next + copy++];
                        if (state.head && len && state.length < 65536) {
                          state.head.comment += String.fromCharCode(len);
                        }
                      } while (len && copy < have);
                      if (state.flags & 512) {
                        state.check = crc32(state.check, input, copy, next);
                      }
                      have -= copy;
                      next += copy;
                      if (len) {
                        break inf_leave;
                      }
                    } else if (state.head) {
                      state.head.comment = null;
                    }
                    state.mode = HCRC;
                  case HCRC:
                    if (state.flags & 512) {
                      while (bits < 16) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      if (hold !== (state.check & 65535)) {
                        strm.msg = "header crc mismatch";
                        state.mode = BAD;
                        break;
                      }
                      hold = 0;
                      bits = 0;
                    }
                    if (state.head) {
                      state.head.hcrc = state.flags >> 9 & 1;
                      state.head.done = true;
                    }
                    strm.adler = state.check = 0;
                    state.mode = TYPE;
                    break;
                  case DICTID:
                    while (bits < 32) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    strm.adler = state.check = zswap32(hold);
                    hold = 0;
                    bits = 0;
                    state.mode = DICT;
                  case DICT:
                    if (state.havedict === 0) {
                      strm.next_out = put;
                      strm.avail_out = left;
                      strm.next_in = next;
                      strm.avail_in = have;
                      state.hold = hold;
                      state.bits = bits;
                      return Z_NEED_DICT;
                    }
                    strm.adler = state.check = 1;
                    state.mode = TYPE;
                  case TYPE:
                    if (flush === Z_BLOCK || flush === Z_TREES) {
                      break inf_leave;
                    }
                  case TYPEDO:
                    if (state.last) {
                      hold >>>= bits & 7;
                      bits -= bits & 7;
                      state.mode = CHECK;
                      break;
                    }
                    while (bits < 3) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    state.last = hold & 1;
                    hold >>>= 1;
                    bits -= 1;
                    switch (hold & 3) {
                      case 0:
                        state.mode = STORED;
                        break;
                      case 1:
                        fixedtables(state);
                        state.mode = LEN_;
                        if (flush === Z_TREES) {
                          hold >>>= 2;
                          bits -= 2;
                          break inf_leave;
                        }
                        break;
                      case 2:
                        state.mode = TABLE;
                        break;
                      case 3:
                        strm.msg = "invalid block type";
                        state.mode = BAD;
                    }
                    hold >>>= 2;
                    bits -= 2;
                    break;
                  case STORED:
                    hold >>>= bits & 7;
                    bits -= bits & 7;
                    while (bits < 32) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
                      strm.msg = "invalid stored block lengths";
                      state.mode = BAD;
                      break;
                    }
                    state.length = hold & 65535;
                    hold = 0;
                    bits = 0;
                    state.mode = COPY_;
                    if (flush === Z_TREES) {
                      break inf_leave;
                    }
                  case COPY_:
                    state.mode = COPY;
                  case COPY:
                    copy = state.length;
                    if (copy) {
                      if (copy > have) {
                        copy = have;
                      }
                      if (copy > left) {
                        copy = left;
                      }
                      if (copy === 0) {
                        break inf_leave;
                      }
                      utils.arraySet(output, input, next, copy, put);
                      have -= copy;
                      next += copy;
                      left -= copy;
                      put += copy;
                      state.length -= copy;
                      break;
                    }
                    state.mode = TYPE;
                    break;
                  case TABLE:
                    while (bits < 14) {
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    state.nlen = (hold & 31) + 257;
                    hold >>>= 5;
                    bits -= 5;
                    state.ndist = (hold & 31) + 1;
                    hold >>>= 5;
                    bits -= 5;
                    state.ncode = (hold & 15) + 4;
                    hold >>>= 4;
                    bits -= 4;
                    if (state.nlen > 286 || state.ndist > 30) {
                      strm.msg = "too many length or distance symbols";
                      state.mode = BAD;
                      break;
                    }
                    state.have = 0;
                    state.mode = LENLENS;
                  case LENLENS:
                    while (state.have < state.ncode) {
                      while (bits < 3) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      state.lens[order[state.have++]] = hold & 7;
                      hold >>>= 3;
                      bits -= 3;
                    }
                    while (state.have < 19) {
                      state.lens[order[state.have++]] = 0;
                    }
                    state.lencode = state.lendyn;
                    state.lenbits = 7;
                    opts = { bits: state.lenbits };
                    ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
                    state.lenbits = opts.bits;
                    if (ret) {
                      strm.msg = "invalid code lengths set";
                      state.mode = BAD;
                      break;
                    }
                    state.have = 0;
                    state.mode = CODELENS;
                  case CODELENS:
                    while (state.have < state.nlen + state.ndist) {
                      for (; ; ) {
                        here = state.lencode[hold & (1 << state.lenbits) - 1];
                        here_bits = here >>> 24;
                        here_op = here >>> 16 & 255;
                        here_val = here & 65535;
                        if (here_bits <= bits) {
                          break;
                        }
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      if (here_val < 16) {
                        hold >>>= here_bits;
                        bits -= here_bits;
                        state.lens[state.have++] = here_val;
                      } else {
                        if (here_val === 16) {
                          n = here_bits + 2;
                          while (bits < n) {
                            if (have === 0) {
                              break inf_leave;
                            }
                            have--;
                            hold += input[next++] << bits;
                            bits += 8;
                          }
                          hold >>>= here_bits;
                          bits -= here_bits;
                          if (state.have === 0) {
                            strm.msg = "invalid bit length repeat";
                            state.mode = BAD;
                            break;
                          }
                          len = state.lens[state.have - 1];
                          copy = 3 + (hold & 3);
                          hold >>>= 2;
                          bits -= 2;
                        } else if (here_val === 17) {
                          n = here_bits + 3;
                          while (bits < n) {
                            if (have === 0) {
                              break inf_leave;
                            }
                            have--;
                            hold += input[next++] << bits;
                            bits += 8;
                          }
                          hold >>>= here_bits;
                          bits -= here_bits;
                          len = 0;
                          copy = 3 + (hold & 7);
                          hold >>>= 3;
                          bits -= 3;
                        } else {
                          n = here_bits + 7;
                          while (bits < n) {
                            if (have === 0) {
                              break inf_leave;
                            }
                            have--;
                            hold += input[next++] << bits;
                            bits += 8;
                          }
                          hold >>>= here_bits;
                          bits -= here_bits;
                          len = 0;
                          copy = 11 + (hold & 127);
                          hold >>>= 7;
                          bits -= 7;
                        }
                        if (state.have + copy > state.nlen + state.ndist) {
                          strm.msg = "invalid bit length repeat";
                          state.mode = BAD;
                          break;
                        }
                        while (copy--) {
                          state.lens[state.have++] = len;
                        }
                      }
                    }
                    if (state.mode === BAD) {
                      break;
                    }
                    if (state.lens[256] === 0) {
                      strm.msg = "invalid code -- missing end-of-block";
                      state.mode = BAD;
                      break;
                    }
                    state.lenbits = 9;
                    opts = { bits: state.lenbits };
                    ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
                    state.lenbits = opts.bits;
                    if (ret) {
                      strm.msg = "invalid literal/lengths set";
                      state.mode = BAD;
                      break;
                    }
                    state.distbits = 6;
                    state.distcode = state.distdyn;
                    opts = { bits: state.distbits };
                    ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
                    state.distbits = opts.bits;
                    if (ret) {
                      strm.msg = "invalid distances set";
                      state.mode = BAD;
                      break;
                    }
                    state.mode = LEN_;
                    if (flush === Z_TREES) {
                      break inf_leave;
                    }
                  case LEN_:
                    state.mode = LEN;
                  case LEN:
                    if (have >= 6 && left >= 258) {
                      strm.next_out = put;
                      strm.avail_out = left;
                      strm.next_in = next;
                      strm.avail_in = have;
                      state.hold = hold;
                      state.bits = bits;
                      inflate_fast(strm, _out);
                      put = strm.next_out;
                      output = strm.output;
                      left = strm.avail_out;
                      next = strm.next_in;
                      input = strm.input;
                      have = strm.avail_in;
                      hold = state.hold;
                      bits = state.bits;
                      if (state.mode === TYPE) {
                        state.back = -1;
                      }
                      break;
                    }
                    state.back = 0;
                    for (; ; ) {
                      here = state.lencode[hold & (1 << state.lenbits) - 1];
                      here_bits = here >>> 24;
                      here_op = here >>> 16 & 255;
                      here_val = here & 65535;
                      if (here_bits <= bits) {
                        break;
                      }
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if (here_op && (here_op & 240) === 0) {
                      last_bits = here_bits;
                      last_op = here_op;
                      last_val = here_val;
                      for (; ; ) {
                        here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                        here_bits = here >>> 24;
                        here_op = here >>> 16 & 255;
                        here_val = here & 65535;
                        if (last_bits + here_bits <= bits) {
                          break;
                        }
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      hold >>>= last_bits;
                      bits -= last_bits;
                      state.back += last_bits;
                    }
                    hold >>>= here_bits;
                    bits -= here_bits;
                    state.back += here_bits;
                    state.length = here_val;
                    if (here_op === 0) {
                      state.mode = LIT;
                      break;
                    }
                    if (here_op & 32) {
                      state.back = -1;
                      state.mode = TYPE;
                      break;
                    }
                    if (here_op & 64) {
                      strm.msg = "invalid literal/length code";
                      state.mode = BAD;
                      break;
                    }
                    state.extra = here_op & 15;
                    state.mode = LENEXT;
                  case LENEXT:
                    if (state.extra) {
                      n = state.extra;
                      while (bits < n) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      state.length += hold & (1 << state.extra) - 1;
                      hold >>>= state.extra;
                      bits -= state.extra;
                      state.back += state.extra;
                    }
                    state.was = state.length;
                    state.mode = DIST;
                  case DIST:
                    for (; ; ) {
                      here = state.distcode[hold & (1 << state.distbits) - 1];
                      here_bits = here >>> 24;
                      here_op = here >>> 16 & 255;
                      here_val = here & 65535;
                      if (here_bits <= bits) {
                        break;
                      }
                      if (have === 0) {
                        break inf_leave;
                      }
                      have--;
                      hold += input[next++] << bits;
                      bits += 8;
                    }
                    if ((here_op & 240) === 0) {
                      last_bits = here_bits;
                      last_op = here_op;
                      last_val = here_val;
                      for (; ; ) {
                        here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                        here_bits = here >>> 24;
                        here_op = here >>> 16 & 255;
                        here_val = here & 65535;
                        if (last_bits + here_bits <= bits) {
                          break;
                        }
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      hold >>>= last_bits;
                      bits -= last_bits;
                      state.back += last_bits;
                    }
                    hold >>>= here_bits;
                    bits -= here_bits;
                    state.back += here_bits;
                    if (here_op & 64) {
                      strm.msg = "invalid distance code";
                      state.mode = BAD;
                      break;
                    }
                    state.offset = here_val;
                    state.extra = here_op & 15;
                    state.mode = DISTEXT;
                  case DISTEXT:
                    if (state.extra) {
                      n = state.extra;
                      while (bits < n) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      state.offset += hold & (1 << state.extra) - 1;
                      hold >>>= state.extra;
                      bits -= state.extra;
                      state.back += state.extra;
                    }
                    if (state.offset > state.dmax) {
                      strm.msg = "invalid distance too far back";
                      state.mode = BAD;
                      break;
                    }
                    state.mode = MATCH;
                  case MATCH:
                    if (left === 0) {
                      break inf_leave;
                    }
                    copy = _out - left;
                    if (state.offset > copy) {
                      copy = state.offset - copy;
                      if (copy > state.whave) {
                        if (state.sane) {
                          strm.msg = "invalid distance too far back";
                          state.mode = BAD;
                          break;
                        }
                      }
                      if (copy > state.wnext) {
                        copy -= state.wnext;
                        from = state.wsize - copy;
                      } else {
                        from = state.wnext - copy;
                      }
                      if (copy > state.length) {
                        copy = state.length;
                      }
                      from_source = state.window;
                    } else {
                      from_source = output;
                      from = put - state.offset;
                      copy = state.length;
                    }
                    if (copy > left) {
                      copy = left;
                    }
                    left -= copy;
                    state.length -= copy;
                    do {
                      output[put++] = from_source[from++];
                    } while (--copy);
                    if (state.length === 0) {
                      state.mode = LEN;
                    }
                    break;
                  case LIT:
                    if (left === 0) {
                      break inf_leave;
                    }
                    output[put++] = state.length;
                    left--;
                    state.mode = LEN;
                    break;
                  case CHECK:
                    if (state.wrap) {
                      while (bits < 32) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold |= input[next++] << bits;
                        bits += 8;
                      }
                      _out -= left;
                      strm.total_out += _out;
                      state.total += _out;
                      if (_out) {
                        strm.adler = state.check = /*UPDATE(state.check, put - _out, _out);*/
                        state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out);
                      }
                      _out = left;
                      if ((state.flags ? hold : zswap32(hold)) !== state.check) {
                        strm.msg = "incorrect data check";
                        state.mode = BAD;
                        break;
                      }
                      hold = 0;
                      bits = 0;
                    }
                    state.mode = LENGTH;
                  case LENGTH:
                    if (state.wrap && state.flags) {
                      while (bits < 32) {
                        if (have === 0) {
                          break inf_leave;
                        }
                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }
                      if (hold !== (state.total & 4294967295)) {
                        strm.msg = "incorrect length check";
                        state.mode = BAD;
                        break;
                      }
                      hold = 0;
                      bits = 0;
                    }
                    state.mode = DONE;
                  case DONE:
                    ret = Z_STREAM_END;
                    break inf_leave;
                  case BAD:
                    ret = Z_DATA_ERROR;
                    break inf_leave;
                  case MEM:
                    return Z_MEM_ERROR;
                  case SYNC:
                  default:
                    return Z_STREAM_ERROR;
                }
              }
            strm.next_out = put;
            strm.avail_out = left;
            strm.next_in = next;
            strm.avail_in = have;
            state.hold = hold;
            state.bits = bits;
            if (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== Z_FINISH)) {
              if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
                state.mode = MEM;
                return Z_MEM_ERROR;
              }
            }
            _in -= strm.avail_in;
            _out -= strm.avail_out;
            strm.total_in += _in;
            strm.total_out += _out;
            state.total += _out;
            if (state.wrap && _out) {
              strm.adler = state.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/
              state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out);
            }
            strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
            if ((_in === 0 && _out === 0 || flush === Z_FINISH) && ret === Z_OK) {
              ret = Z_BUF_ERROR;
            }
            return ret;
          }
          function inflateEnd(strm) {
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            var state = strm.state;
            if (state.window) {
              state.window = null;
            }
            strm.state = null;
            return Z_OK;
          }
          function inflateGetHeader(strm, head) {
            var state;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            if ((state.wrap & 2) === 0) {
              return Z_STREAM_ERROR;
            }
            state.head = head;
            head.done = false;
            return Z_OK;
          }
          function inflateSetDictionary(strm, dictionary) {
            var dictLength = dictionary.length;
            var state;
            var dictid;
            var ret;
            if (!strm || !strm.state) {
              return Z_STREAM_ERROR;
            }
            state = strm.state;
            if (state.wrap !== 0 && state.mode !== DICT) {
              return Z_STREAM_ERROR;
            }
            if (state.mode === DICT) {
              dictid = 1;
              dictid = adler32(dictid, dictionary, dictLength, 0);
              if (dictid !== state.check) {
                return Z_DATA_ERROR;
              }
            }
            ret = updatewindow(strm, dictionary, dictLength, dictLength);
            if (ret) {
              state.mode = MEM;
              return Z_MEM_ERROR;
            }
            state.havedict = 1;
            return Z_OK;
          }
          exports3.inflateReset = inflateReset;
          exports3.inflateReset2 = inflateReset2;
          exports3.inflateResetKeep = inflateResetKeep;
          exports3.inflateInit = inflateInit;
          exports3.inflateInit2 = inflateInit2;
          exports3.inflate = inflate;
          exports3.inflateEnd = inflateEnd;
          exports3.inflateGetHeader = inflateGetHeader;
          exports3.inflateSetDictionary = inflateSetDictionary;
          exports3.inflateInfo = "pako inflate (from Nodeca project)";
        }, { "../utils/common": 52, "./adler32": 53, "./crc32": 55, "./inffast": 57, "./inftrees": 59 }], 59: [function(require2, module3, exports3) {
          "use strict";
          var utils = require2("../utils/common");
          var MAXBITS = 15;
          var ENOUGH_LENS = 852;
          var ENOUGH_DISTS = 592;
          var CODES = 0;
          var LENS = 1;
          var DISTS = 2;
          var lbase = [
            /* Length codes 257..285 base */
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            13,
            15,
            17,
            19,
            23,
            27,
            31,
            35,
            43,
            51,
            59,
            67,
            83,
            99,
            115,
            131,
            163,
            195,
            227,
            258,
            0,
            0
          ];
          var lext = [
            /* Length codes 257..285 extra */
            16,
            16,
            16,
            16,
            16,
            16,
            16,
            16,
            17,
            17,
            17,
            17,
            18,
            18,
            18,
            18,
            19,
            19,
            19,
            19,
            20,
            20,
            20,
            20,
            21,
            21,
            21,
            21,
            16,
            72,
            78
          ];
          var dbase = [
            /* Distance codes 0..29 base */
            1,
            2,
            3,
            4,
            5,
            7,
            9,
            13,
            17,
            25,
            33,
            49,
            65,
            97,
            129,
            193,
            257,
            385,
            513,
            769,
            1025,
            1537,
            2049,
            3073,
            4097,
            6145,
            8193,
            12289,
            16385,
            24577,
            0,
            0
          ];
          var dext = [
            /* Distance codes 0..29 extra */
            16,
            16,
            16,
            16,
            17,
            17,
            18,
            18,
            19,
            19,
            20,
            20,
            21,
            21,
            22,
            22,
            23,
            23,
            24,
            24,
            25,
            25,
            26,
            26,
            27,
            27,
            28,
            28,
            29,
            29,
            64,
            64
          ];
          module3.exports = function inflate_table(type, lens, lens_index, codes, table, table_index, work, opts) {
            var bits = opts.bits;
            var len = 0;
            var sym = 0;
            var min = 0, max = 0;
            var root = 0;
            var curr = 0;
            var drop = 0;
            var left = 0;
            var used = 0;
            var huff = 0;
            var incr;
            var fill;
            var low;
            var mask;
            var next;
            var base = null;
            var base_index = 0;
            var end;
            var count = new utils.Buf16(MAXBITS + 1);
            var offs = new utils.Buf16(MAXBITS + 1);
            var extra = null;
            var extra_index = 0;
            var here_bits, here_op, here_val;
            for (len = 0; len <= MAXBITS; len++) {
              count[len] = 0;
            }
            for (sym = 0; sym < codes; sym++) {
              count[lens[lens_index + sym]]++;
            }
            root = bits;
            for (max = MAXBITS; max >= 1; max--) {
              if (count[max] !== 0) {
                break;
              }
            }
            if (root > max) {
              root = max;
            }
            if (max === 0) {
              table[table_index++] = 1 << 24 | 64 << 16 | 0;
              table[table_index++] = 1 << 24 | 64 << 16 | 0;
              opts.bits = 1;
              return 0;
            }
            for (min = 1; min < max; min++) {
              if (count[min] !== 0) {
                break;
              }
            }
            if (root < min) {
              root = min;
            }
            left = 1;
            for (len = 1; len <= MAXBITS; len++) {
              left <<= 1;
              left -= count[len];
              if (left < 0) {
                return -1;
              }
            }
            if (left > 0 && (type === CODES || max !== 1)) {
              return -1;
            }
            offs[1] = 0;
            for (len = 1; len < MAXBITS; len++) {
              offs[len + 1] = offs[len] + count[len];
            }
            for (sym = 0; sym < codes; sym++) {
              if (lens[lens_index + sym] !== 0) {
                work[offs[lens[lens_index + sym]]++] = sym;
              }
            }
            if (type === CODES) {
              base = extra = work;
              end = 19;
            } else if (type === LENS) {
              base = lbase;
              base_index -= 257;
              extra = lext;
              extra_index -= 257;
              end = 256;
            } else {
              base = dbase;
              extra = dext;
              end = -1;
            }
            huff = 0;
            sym = 0;
            len = min;
            next = table_index;
            curr = root;
            drop = 0;
            low = -1;
            used = 1 << root;
            mask = used - 1;
            if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
              return 1;
            }
            for (; ; ) {
              here_bits = len - drop;
              if (work[sym] < end) {
                here_op = 0;
                here_val = work[sym];
              } else if (work[sym] > end) {
                here_op = extra[extra_index + work[sym]];
                here_val = base[base_index + work[sym]];
              } else {
                here_op = 32 + 64;
                here_val = 0;
              }
              incr = 1 << len - drop;
              fill = 1 << curr;
              min = fill;
              do {
                fill -= incr;
                table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
              } while (fill !== 0);
              incr = 1 << len - 1;
              while (huff & incr) {
                incr >>= 1;
              }
              if (incr !== 0) {
                huff &= incr - 1;
                huff += incr;
              } else {
                huff = 0;
              }
              sym++;
              if (--count[len] === 0) {
                if (len === max) {
                  break;
                }
                len = lens[lens_index + work[sym]];
              }
              if (len > root && (huff & mask) !== low) {
                if (drop === 0) {
                  drop = root;
                }
                next += min;
                curr = len - drop;
                left = 1 << curr;
                while (curr + drop < max) {
                  left -= count[curr + drop];
                  if (left <= 0) {
                    break;
                  }
                  curr++;
                  left <<= 1;
                }
                used += 1 << curr;
                if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
                  return 1;
                }
                low = huff & mask;
                table[low] = root << 24 | curr << 16 | next - table_index | 0;
              }
            }
            if (huff !== 0) {
              table[next + huff] = len - drop << 24 | 64 << 16 | 0;
            }
            opts.bits = root;
            return 0;
          };
        }, { "../utils/common": 52 }], 60: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = {
            2: "need dictionary",
            /* Z_NEED_DICT       2  */
            1: "stream end",
            /* Z_STREAM_END      1  */
            0: "",
            /* Z_OK              0  */
            "-1": "file error",
            /* Z_ERRNO         (-1) */
            "-2": "stream error",
            /* Z_STREAM_ERROR  (-2) */
            "-3": "data error",
            /* Z_DATA_ERROR    (-3) */
            "-4": "insufficient memory",
            /* Z_MEM_ERROR     (-4) */
            "-5": "buffer error",
            /* Z_BUF_ERROR     (-5) */
            "-6": "incompatible version"
            /* Z_VERSION_ERROR (-6) */
          };
        }, {}], 61: [function(require2, module3, exports3) {
          "use strict";
          var utils = require2("../utils/common");
          var Z_FIXED = 4;
          var Z_BINARY = 0;
          var Z_TEXT = 1;
          var Z_UNKNOWN = 2;
          function zero(buf) {
            var len = buf.length;
            while (--len >= 0) {
              buf[len] = 0;
            }
          }
          var STORED_BLOCK = 0;
          var STATIC_TREES = 1;
          var DYN_TREES = 2;
          var MIN_MATCH = 3;
          var MAX_MATCH = 258;
          var LENGTH_CODES = 29;
          var LITERALS = 256;
          var L_CODES = LITERALS + 1 + LENGTH_CODES;
          var D_CODES = 30;
          var BL_CODES = 19;
          var HEAP_SIZE = 2 * L_CODES + 1;
          var MAX_BITS = 15;
          var Buf_size = 16;
          var MAX_BL_BITS = 7;
          var END_BLOCK = 256;
          var REP_3_6 = 16;
          var REPZ_3_10 = 17;
          var REPZ_11_138 = 18;
          var extra_lbits = (
            /* extra bits for each length code */
            [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
          );
          var extra_dbits = (
            /* extra bits for each distance code */
            [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
          );
          var extra_blbits = (
            /* extra bits for each bit length code */
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7]
          );
          var bl_order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          var DIST_CODE_LEN = 512;
          var static_ltree = new Array((L_CODES + 2) * 2);
          zero(static_ltree);
          var static_dtree = new Array(D_CODES * 2);
          zero(static_dtree);
          var _dist_code = new Array(DIST_CODE_LEN);
          zero(_dist_code);
          var _length_code = new Array(MAX_MATCH - MIN_MATCH + 1);
          zero(_length_code);
          var base_length = new Array(LENGTH_CODES);
          zero(base_length);
          var base_dist = new Array(D_CODES);
          zero(base_dist);
          function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {
            this.static_tree = static_tree;
            this.extra_bits = extra_bits;
            this.extra_base = extra_base;
            this.elems = elems;
            this.max_length = max_length;
            this.has_stree = static_tree && static_tree.length;
          }
          var static_l_desc;
          var static_d_desc;
          var static_bl_desc;
          function TreeDesc(dyn_tree, stat_desc) {
            this.dyn_tree = dyn_tree;
            this.max_code = 0;
            this.stat_desc = stat_desc;
          }
          function d_code(dist) {
            return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
          }
          function put_short(s, w) {
            s.pending_buf[s.pending++] = w & 255;
            s.pending_buf[s.pending++] = w >>> 8 & 255;
          }
          function send_bits(s, value, length) {
            if (s.bi_valid > Buf_size - length) {
              s.bi_buf |= value << s.bi_valid & 65535;
              put_short(s, s.bi_buf);
              s.bi_buf = value >> Buf_size - s.bi_valid;
              s.bi_valid += length - Buf_size;
            } else {
              s.bi_buf |= value << s.bi_valid & 65535;
              s.bi_valid += length;
            }
          }
          function send_code(s, c, tree) {
            send_bits(
              s,
              tree[c * 2],
              tree[c * 2 + 1]
              /*.Len*/
            );
          }
          function bi_reverse(code, len) {
            var res = 0;
            do {
              res |= code & 1;
              code >>>= 1;
              res <<= 1;
            } while (--len > 0);
            return res >>> 1;
          }
          function bi_flush(s) {
            if (s.bi_valid === 16) {
              put_short(s, s.bi_buf);
              s.bi_buf = 0;
              s.bi_valid = 0;
            } else if (s.bi_valid >= 8) {
              s.pending_buf[s.pending++] = s.bi_buf & 255;
              s.bi_buf >>= 8;
              s.bi_valid -= 8;
            }
          }
          function gen_bitlen(s, desc) {
            var tree = desc.dyn_tree;
            var max_code = desc.max_code;
            var stree = desc.stat_desc.static_tree;
            var has_stree = desc.stat_desc.has_stree;
            var extra = desc.stat_desc.extra_bits;
            var base = desc.stat_desc.extra_base;
            var max_length = desc.stat_desc.max_length;
            var h;
            var n, m;
            var bits;
            var xbits;
            var f;
            var overflow = 0;
            for (bits = 0; bits <= MAX_BITS; bits++) {
              s.bl_count[bits] = 0;
            }
            tree[s.heap[s.heap_max] * 2 + 1] = 0;
            for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
              n = s.heap[h];
              bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
              if (bits > max_length) {
                bits = max_length;
                overflow++;
              }
              tree[n * 2 + 1] = bits;
              if (n > max_code) {
                continue;
              }
              s.bl_count[bits]++;
              xbits = 0;
              if (n >= base) {
                xbits = extra[n - base];
              }
              f = tree[n * 2];
              s.opt_len += f * (bits + xbits);
              if (has_stree) {
                s.static_len += f * (stree[n * 2 + 1] + xbits);
              }
            }
            if (overflow === 0) {
              return;
            }
            do {
              bits = max_length - 1;
              while (s.bl_count[bits] === 0) {
                bits--;
              }
              s.bl_count[bits]--;
              s.bl_count[bits + 1] += 2;
              s.bl_count[max_length]--;
              overflow -= 2;
            } while (overflow > 0);
            for (bits = max_length; bits !== 0; bits--) {
              n = s.bl_count[bits];
              while (n !== 0) {
                m = s.heap[--h];
                if (m > max_code) {
                  continue;
                }
                if (tree[m * 2 + 1] !== bits) {
                  s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
                  tree[m * 2 + 1] = bits;
                }
                n--;
              }
            }
          }
          function gen_codes(tree, max_code, bl_count) {
            var next_code = new Array(MAX_BITS + 1);
            var code = 0;
            var bits;
            var n;
            for (bits = 1; bits <= MAX_BITS; bits++) {
              next_code[bits] = code = code + bl_count[bits - 1] << 1;
            }
            for (n = 0; n <= max_code; n++) {
              var len = tree[n * 2 + 1];
              if (len === 0) {
                continue;
              }
              tree[n * 2] = bi_reverse(next_code[len]++, len);
            }
          }
          function tr_static_init() {
            var n;
            var bits;
            var length;
            var code;
            var dist;
            var bl_count = new Array(MAX_BITS + 1);
            length = 0;
            for (code = 0; code < LENGTH_CODES - 1; code++) {
              base_length[code] = length;
              for (n = 0; n < 1 << extra_lbits[code]; n++) {
                _length_code[length++] = code;
              }
            }
            _length_code[length - 1] = code;
            dist = 0;
            for (code = 0; code < 16; code++) {
              base_dist[code] = dist;
              for (n = 0; n < 1 << extra_dbits[code]; n++) {
                _dist_code[dist++] = code;
              }
            }
            dist >>= 7;
            for (; code < D_CODES; code++) {
              base_dist[code] = dist << 7;
              for (n = 0; n < 1 << extra_dbits[code] - 7; n++) {
                _dist_code[256 + dist++] = code;
              }
            }
            for (bits = 0; bits <= MAX_BITS; bits++) {
              bl_count[bits] = 0;
            }
            n = 0;
            while (n <= 143) {
              static_ltree[n * 2 + 1] = 8;
              n++;
              bl_count[8]++;
            }
            while (n <= 255) {
              static_ltree[n * 2 + 1] = 9;
              n++;
              bl_count[9]++;
            }
            while (n <= 279) {
              static_ltree[n * 2 + 1] = 7;
              n++;
              bl_count[7]++;
            }
            while (n <= 287) {
              static_ltree[n * 2 + 1] = 8;
              n++;
              bl_count[8]++;
            }
            gen_codes(static_ltree, L_CODES + 1, bl_count);
            for (n = 0; n < D_CODES; n++) {
              static_dtree[n * 2 + 1] = 5;
              static_dtree[n * 2] = bi_reverse(n, 5);
            }
            static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
            static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0, D_CODES, MAX_BITS);
            static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0, BL_CODES, MAX_BL_BITS);
          }
          function init_block(s) {
            var n;
            for (n = 0; n < L_CODES; n++) {
              s.dyn_ltree[n * 2] = 0;
            }
            for (n = 0; n < D_CODES; n++) {
              s.dyn_dtree[n * 2] = 0;
            }
            for (n = 0; n < BL_CODES; n++) {
              s.bl_tree[n * 2] = 0;
            }
            s.dyn_ltree[END_BLOCK * 2] = 1;
            s.opt_len = s.static_len = 0;
            s.last_lit = s.matches = 0;
          }
          function bi_windup(s) {
            if (s.bi_valid > 8) {
              put_short(s, s.bi_buf);
            } else if (s.bi_valid > 0) {
              s.pending_buf[s.pending++] = s.bi_buf;
            }
            s.bi_buf = 0;
            s.bi_valid = 0;
          }
          function copy_block(s, buf, len, header) {
            bi_windup(s);
            if (header) {
              put_short(s, len);
              put_short(s, ~len);
            }
            utils.arraySet(s.pending_buf, s.window, buf, len, s.pending);
            s.pending += len;
          }
          function smaller(tree, n, m, depth) {
            var _n2 = n * 2;
            var _m2 = m * 2;
            return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
          }
          function pqdownheap(s, tree, k) {
            var v = s.heap[k];
            var j = k << 1;
            while (j <= s.heap_len) {
              if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
                j++;
              }
              if (smaller(tree, v, s.heap[j], s.depth)) {
                break;
              }
              s.heap[k] = s.heap[j];
              k = j;
              j <<= 1;
            }
            s.heap[k] = v;
          }
          function compress_block(s, ltree, dtree) {
            var dist;
            var lc;
            var lx = 0;
            var code;
            var extra;
            if (s.last_lit !== 0) {
              do {
                dist = s.pending_buf[s.d_buf + lx * 2] << 8 | s.pending_buf[s.d_buf + lx * 2 + 1];
                lc = s.pending_buf[s.l_buf + lx];
                lx++;
                if (dist === 0) {
                  send_code(s, lc, ltree);
                } else {
                  code = _length_code[lc];
                  send_code(s, code + LITERALS + 1, ltree);
                  extra = extra_lbits[code];
                  if (extra !== 0) {
                    lc -= base_length[code];
                    send_bits(s, lc, extra);
                  }
                  dist--;
                  code = d_code(dist);
                  send_code(s, code, dtree);
                  extra = extra_dbits[code];
                  if (extra !== 0) {
                    dist -= base_dist[code];
                    send_bits(s, dist, extra);
                  }
                }
              } while (lx < s.last_lit);
            }
            send_code(s, END_BLOCK, ltree);
          }
          function build_tree(s, desc) {
            var tree = desc.dyn_tree;
            var stree = desc.stat_desc.static_tree;
            var has_stree = desc.stat_desc.has_stree;
            var elems = desc.stat_desc.elems;
            var n, m;
            var max_code = -1;
            var node;
            s.heap_len = 0;
            s.heap_max = HEAP_SIZE;
            for (n = 0; n < elems; n++) {
              if (tree[n * 2] !== 0) {
                s.heap[++s.heap_len] = max_code = n;
                s.depth[n] = 0;
              } else {
                tree[n * 2 + 1] = 0;
              }
            }
            while (s.heap_len < 2) {
              node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
              tree[node * 2] = 1;
              s.depth[node] = 0;
              s.opt_len--;
              if (has_stree) {
                s.static_len -= stree[node * 2 + 1];
              }
            }
            desc.max_code = max_code;
            for (n = s.heap_len >> 1; n >= 1; n--) {
              pqdownheap(s, tree, n);
            }
            node = elems;
            do {
              n = s.heap[
                1
                /*SMALLEST*/
              ];
              s.heap[
                1
                /*SMALLEST*/
              ] = s.heap[s.heap_len--];
              pqdownheap(
                s,
                tree,
                1
                /*SMALLEST*/
              );
              m = s.heap[
                1
                /*SMALLEST*/
              ];
              s.heap[--s.heap_max] = n;
              s.heap[--s.heap_max] = m;
              tree[node * 2] = tree[n * 2] + tree[m * 2];
              s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
              tree[n * 2 + 1] = tree[m * 2 + 1] = node;
              s.heap[
                1
                /*SMALLEST*/
              ] = node++;
              pqdownheap(
                s,
                tree,
                1
                /*SMALLEST*/
              );
            } while (s.heap_len >= 2);
            s.heap[--s.heap_max] = s.heap[
              1
              /*SMALLEST*/
            ];
            gen_bitlen(s, desc);
            gen_codes(tree, max_code, s.bl_count);
          }
          function scan_tree(s, tree, max_code) {
            var n;
            var prevlen = -1;
            var curlen;
            var nextlen = tree[0 * 2 + 1];
            var count = 0;
            var max_count = 7;
            var min_count = 4;
            if (nextlen === 0) {
              max_count = 138;
              min_count = 3;
            }
            tree[(max_code + 1) * 2 + 1] = 65535;
            for (n = 0; n <= max_code; n++) {
              curlen = nextlen;
              nextlen = tree[(n + 1) * 2 + 1];
              if (++count < max_count && curlen === nextlen) {
                continue;
              } else if (count < min_count) {
                s.bl_tree[curlen * 2] += count;
              } else if (curlen !== 0) {
                if (curlen !== prevlen) {
                  s.bl_tree[curlen * 2]++;
                }
                s.bl_tree[REP_3_6 * 2]++;
              } else if (count <= 10) {
                s.bl_tree[REPZ_3_10 * 2]++;
              } else {
                s.bl_tree[REPZ_11_138 * 2]++;
              }
              count = 0;
              prevlen = curlen;
              if (nextlen === 0) {
                max_count = 138;
                min_count = 3;
              } else if (curlen === nextlen) {
                max_count = 6;
                min_count = 3;
              } else {
                max_count = 7;
                min_count = 4;
              }
            }
          }
          function send_tree(s, tree, max_code) {
            var n;
            var prevlen = -1;
            var curlen;
            var nextlen = tree[0 * 2 + 1];
            var count = 0;
            var max_count = 7;
            var min_count = 4;
            if (nextlen === 0) {
              max_count = 138;
              min_count = 3;
            }
            for (n = 0; n <= max_code; n++) {
              curlen = nextlen;
              nextlen = tree[(n + 1) * 2 + 1];
              if (++count < max_count && curlen === nextlen) {
                continue;
              } else if (count < min_count) {
                do {
                  send_code(s, curlen, s.bl_tree);
                } while (--count !== 0);
              } else if (curlen !== 0) {
                if (curlen !== prevlen) {
                  send_code(s, curlen, s.bl_tree);
                  count--;
                }
                send_code(s, REP_3_6, s.bl_tree);
                send_bits(s, count - 3, 2);
              } else if (count <= 10) {
                send_code(s, REPZ_3_10, s.bl_tree);
                send_bits(s, count - 3, 3);
              } else {
                send_code(s, REPZ_11_138, s.bl_tree);
                send_bits(s, count - 11, 7);
              }
              count = 0;
              prevlen = curlen;
              if (nextlen === 0) {
                max_count = 138;
                min_count = 3;
              } else if (curlen === nextlen) {
                max_count = 6;
                min_count = 3;
              } else {
                max_count = 7;
                min_count = 4;
              }
            }
          }
          function build_bl_tree(s) {
            var max_blindex;
            scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
            scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
            build_tree(s, s.bl_desc);
            for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
              if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) {
                break;
              }
            }
            s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
            return max_blindex;
          }
          function send_all_trees(s, lcodes, dcodes, blcodes) {
            var rank;
            send_bits(s, lcodes - 257, 5);
            send_bits(s, dcodes - 1, 5);
            send_bits(s, blcodes - 4, 4);
            for (rank = 0; rank < blcodes; rank++) {
              send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1], 3);
            }
            send_tree(s, s.dyn_ltree, lcodes - 1);
            send_tree(s, s.dyn_dtree, dcodes - 1);
          }
          function detect_data_type(s) {
            var black_mask = 4093624447;
            var n;
            for (n = 0; n <= 31; n++, black_mask >>>= 1) {
              if (black_mask & 1 && s.dyn_ltree[n * 2] !== 0) {
                return Z_BINARY;
              }
            }
            if (s.dyn_ltree[9 * 2] !== 0 || s.dyn_ltree[10 * 2] !== 0 || s.dyn_ltree[13 * 2] !== 0) {
              return Z_TEXT;
            }
            for (n = 32; n < LITERALS; n++) {
              if (s.dyn_ltree[n * 2] !== 0) {
                return Z_TEXT;
              }
            }
            return Z_BINARY;
          }
          var static_init_done = false;
          function _tr_init(s) {
            if (!static_init_done) {
              tr_static_init();
              static_init_done = true;
            }
            s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
            s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
            s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
            s.bi_buf = 0;
            s.bi_valid = 0;
            init_block(s);
          }
          function _tr_stored_block(s, buf, stored_len, last) {
            send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
            copy_block(s, buf, stored_len, true);
          }
          function _tr_align(s) {
            send_bits(s, STATIC_TREES << 1, 3);
            send_code(s, END_BLOCK, static_ltree);
            bi_flush(s);
          }
          function _tr_flush_block(s, buf, stored_len, last) {
            var opt_lenb, static_lenb;
            var max_blindex = 0;
            if (s.level > 0) {
              if (s.strm.data_type === Z_UNKNOWN) {
                s.strm.data_type = detect_data_type(s);
              }
              build_tree(s, s.l_desc);
              build_tree(s, s.d_desc);
              max_blindex = build_bl_tree(s);
              opt_lenb = s.opt_len + 3 + 7 >>> 3;
              static_lenb = s.static_len + 3 + 7 >>> 3;
              if (static_lenb <= opt_lenb) {
                opt_lenb = static_lenb;
              }
            } else {
              opt_lenb = static_lenb = stored_len + 5;
            }
            if (stored_len + 4 <= opt_lenb && buf !== -1) {
              _tr_stored_block(s, buf, stored_len, last);
            } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {
              send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
              compress_block(s, static_ltree, static_dtree);
            } else {
              send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
              send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
              compress_block(s, s.dyn_ltree, s.dyn_dtree);
            }
            init_block(s);
            if (last) {
              bi_windup(s);
            }
          }
          function _tr_tally(s, dist, lc) {
            s.pending_buf[s.d_buf + s.last_lit * 2] = dist >>> 8 & 255;
            s.pending_buf[s.d_buf + s.last_lit * 2 + 1] = dist & 255;
            s.pending_buf[s.l_buf + s.last_lit] = lc & 255;
            s.last_lit++;
            if (dist === 0) {
              s.dyn_ltree[lc * 2]++;
            } else {
              s.matches++;
              dist--;
              s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]++;
              s.dyn_dtree[d_code(dist) * 2]++;
            }
            return s.last_lit === s.lit_bufsize - 1;
          }
          exports3._tr_init = _tr_init;
          exports3._tr_stored_block = _tr_stored_block;
          exports3._tr_flush_block = _tr_flush_block;
          exports3._tr_tally = _tr_tally;
          exports3._tr_align = _tr_align;
        }, { "../utils/common": 52 }], 62: [function(require2, module3, exports3) {
          "use strict";
          function ZStream() {
            this.input = null;
            this.next_in = 0;
            this.avail_in = 0;
            this.total_in = 0;
            this.output = null;
            this.next_out = 0;
            this.avail_out = 0;
            this.total_out = 0;
            this.msg = "";
            this.state = null;
            this.data_type = 2;
            this.adler = 0;
          }
          module3.exports = ZStream;
        }, {}], 63: [function(require2, module3, exports3) {
          var process = module3.exports = {};
          var cachedSetTimeout;
          var cachedClearTimeout;
          function defaultSetTimout() {
            throw new Error("setTimeout has not been defined");
          }
          function defaultClearTimeout() {
            throw new Error("clearTimeout has not been defined");
          }
          (function() {
            try {
              if (typeof setTimeout === "function") {
                cachedSetTimeout = setTimeout;
              } else {
                cachedSetTimeout = defaultSetTimout;
              }
            } catch (e) {
              cachedSetTimeout = defaultSetTimout;
            }
            try {
              if (typeof clearTimeout === "function") {
                cachedClearTimeout = clearTimeout;
              } else {
                cachedClearTimeout = defaultClearTimeout;
              }
            } catch (e) {
              cachedClearTimeout = defaultClearTimeout;
            }
          })();
          function runTimeout(fun) {
            if (cachedSetTimeout === setTimeout) {
              return setTimeout(fun, 0);
            }
            if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
              cachedSetTimeout = setTimeout;
              return setTimeout(fun, 0);
            }
            try {
              return cachedSetTimeout(fun, 0);
            } catch (e) {
              try {
                return cachedSetTimeout.call(null, fun, 0);
              } catch (e2) {
                return cachedSetTimeout.call(this, fun, 0);
              }
            }
          }
          function runClearTimeout(marker) {
            if (cachedClearTimeout === clearTimeout) {
              return clearTimeout(marker);
            }
            if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
              cachedClearTimeout = clearTimeout;
              return clearTimeout(marker);
            }
            try {
              return cachedClearTimeout(marker);
            } catch (e) {
              try {
                return cachedClearTimeout.call(null, marker);
              } catch (e2) {
                return cachedClearTimeout.call(this, marker);
              }
            }
          }
          var queue = [];
          var draining = false;
          var currentQueue;
          var queueIndex = -1;
          function cleanUpNextTick() {
            if (!draining || !currentQueue) {
              return;
            }
            draining = false;
            if (currentQueue.length) {
              queue = currentQueue.concat(queue);
            } else {
              queueIndex = -1;
            }
            if (queue.length) {
              drainQueue();
            }
          }
          function drainQueue() {
            if (draining) {
              return;
            }
            var timeout = runTimeout(cleanUpNextTick);
            draining = true;
            var len = queue.length;
            while (len) {
              currentQueue = queue;
              queue = [];
              while (++queueIndex < len) {
                if (currentQueue) {
                  currentQueue[queueIndex].run();
                }
              }
              queueIndex = -1;
              len = queue.length;
            }
            currentQueue = null;
            draining = false;
            runClearTimeout(timeout);
          }
          process.nextTick = function(fun) {
            var args = new Array(arguments.length - 1);
            if (arguments.length > 1) {
              for (var i = 1; i < arguments.length; i++) {
                args[i - 1] = arguments[i];
              }
            }
            queue.push(new Item(fun, args));
            if (queue.length === 1 && !draining) {
              runTimeout(drainQueue);
            }
          };
          function Item(fun, array) {
            this.fun = fun;
            this.array = array;
          }
          Item.prototype.run = function() {
            this.fun.apply(null, this.array);
          };
          process.title = "browser";
          process.browser = true;
          process.env = {};
          process.argv = [];
          process.version = "";
          process.versions = {};
          function noop() {
          }
          process.on = noop;
          process.addListener = noop;
          process.once = noop;
          process.off = noop;
          process.removeListener = noop;
          process.removeAllListeners = noop;
          process.emit = noop;
          process.prependListener = noop;
          process.prependOnceListener = noop;
          process.listeners = function(name) {
            return [];
          };
          process.binding = function(name) {
            throw new Error("process.binding is not supported");
          };
          process.cwd = function() {
            return "/";
          };
          process.chdir = function(dir) {
            throw new Error("process.chdir is not supported");
          };
          process.umask = function() {
            return 0;
          };
        }, {}], 64: [function(require2, module3, exports3) {
          var buffer = require2("buffer");
          var Buffer2 = buffer.Buffer;
          function copyProps(src, dst) {
            for (var key in src) {
              dst[key] = src[key];
            }
          }
          if (Buffer2.from && Buffer2.alloc && Buffer2.allocUnsafe && Buffer2.allocUnsafeSlow) {
            module3.exports = buffer;
          } else {
            copyProps(buffer, exports3);
            exports3.Buffer = SafeBuffer;
          }
          function SafeBuffer(arg, encodingOrOffset, length) {
            return Buffer2(arg, encodingOrOffset, length);
          }
          SafeBuffer.prototype = Object.create(Buffer2.prototype);
          copyProps(Buffer2, SafeBuffer);
          SafeBuffer.from = function(arg, encodingOrOffset, length) {
            if (typeof arg === "number") {
              throw new TypeError("Argument must not be a number");
            }
            return Buffer2(arg, encodingOrOffset, length);
          };
          SafeBuffer.alloc = function(size, fill, encoding) {
            if (typeof size !== "number") {
              throw new TypeError("Argument must be a number");
            }
            var buf = Buffer2(size);
            if (fill !== void 0) {
              if (typeof encoding === "string") {
                buf.fill(fill, encoding);
              } else {
                buf.fill(fill);
              }
            } else {
              buf.fill(0);
            }
            return buf;
          };
          SafeBuffer.allocUnsafe = function(size) {
            if (typeof size !== "number") {
              throw new TypeError("Argument must be a number");
            }
            return Buffer2(size);
          };
          SafeBuffer.allocUnsafeSlow = function(size) {
            if (typeof size !== "number") {
              throw new TypeError("Argument must be a number");
            }
            return buffer.SlowBuffer(size);
          };
        }, { "buffer": 32 }], 65: [function(require2, module3, exports3) {
          module3.exports = Stream;
          var EE = require2("events").EventEmitter;
          var inherits = require2("inherits");
          inherits(Stream, EE);
          Stream.Readable = require2("readable-stream/lib/_stream_readable.js");
          Stream.Writable = require2("readable-stream/lib/_stream_writable.js");
          Stream.Duplex = require2("readable-stream/lib/_stream_duplex.js");
          Stream.Transform = require2("readable-stream/lib/_stream_transform.js");
          Stream.PassThrough = require2("readable-stream/lib/_stream_passthrough.js");
          Stream.finished = require2("readable-stream/lib/internal/streams/end-of-stream.js");
          Stream.pipeline = require2("readable-stream/lib/internal/streams/pipeline.js");
          Stream.Stream = Stream;
          function Stream() {
            EE.call(this);
          }
          Stream.prototype.pipe = function(dest, options) {
            var source = this;
            function ondata(chunk) {
              if (dest.writable) {
                if (false === dest.write(chunk) && source.pause) {
                  source.pause();
                }
              }
            }
            source.on("data", ondata);
            function ondrain() {
              if (source.readable && source.resume) {
                source.resume();
              }
            }
            dest.on("drain", ondrain);
            if (!dest._isStdio && (!options || options.end !== false)) {
              source.on("end", onend);
              source.on("close", onclose);
            }
            var didOnEnd = false;
            function onend() {
              if (didOnEnd) return;
              didOnEnd = true;
              dest.end();
            }
            function onclose() {
              if (didOnEnd) return;
              didOnEnd = true;
              if (typeof dest.destroy === "function") dest.destroy();
            }
            function onerror(er) {
              cleanup();
              if (EE.listenerCount(this, "error") === 0) {
                throw er;
              }
            }
            source.on("error", onerror);
            dest.on("error", onerror);
            function cleanup() {
              source.removeListener("data", ondata);
              dest.removeListener("drain", ondrain);
              source.removeListener("end", onend);
              source.removeListener("close", onclose);
              source.removeListener("error", onerror);
              dest.removeListener("error", onerror);
              source.removeListener("end", cleanup);
              source.removeListener("close", cleanup);
              dest.removeListener("close", cleanup);
            }
            source.on("end", cleanup);
            source.on("close", cleanup);
            dest.on("close", cleanup);
            dest.emit("pipe", source);
            return dest;
          };
        }, { "events": 35, "inherits": 46, "readable-stream/lib/_stream_duplex.js": 67, "readable-stream/lib/_stream_passthrough.js": 68, "readable-stream/lib/_stream_readable.js": 69, "readable-stream/lib/_stream_transform.js": 70, "readable-stream/lib/_stream_writable.js": 71, "readable-stream/lib/internal/streams/end-of-stream.js": 75, "readable-stream/lib/internal/streams/pipeline.js": 77 }], 66: [function(require2, module3, exports3) {
          "use strict";
          function _inheritsLoose(subClass, superClass) {
            subClass.prototype = Object.create(superClass.prototype);
            subClass.prototype.constructor = subClass;
            subClass.__proto__ = superClass;
          }
          var codes = {};
          function createErrorType(code, message, Base) {
            if (!Base) {
              Base = Error;
            }
            function getMessage(arg1, arg2, arg3) {
              if (typeof message === "string") {
                return message;
              } else {
                return message(arg1, arg2, arg3);
              }
            }
            var NodeError = /* @__PURE__ */ function(_Base) {
              _inheritsLoose(NodeError2, _Base);
              function NodeError2(arg1, arg2, arg3) {
                return _Base.call(this, getMessage(arg1, arg2, arg3)) || this;
              }
              return NodeError2;
            }(Base);
            NodeError.prototype.name = Base.name;
            NodeError.prototype.code = code;
            codes[code] = NodeError;
          }
          function oneOf(expected, thing) {
            if (Array.isArray(expected)) {
              var len = expected.length;
              expected = expected.map(function(i) {
                return String(i);
              });
              if (len > 2) {
                return "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(", "), ", or ") + expected[len - 1];
              } else if (len === 2) {
                return "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1]);
              } else {
                return "of ".concat(thing, " ").concat(expected[0]);
              }
            } else {
              return "of ".concat(thing, " ").concat(String(expected));
            }
          }
          function startsWith(str, search, pos) {
            return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
          }
          function endsWith(str, search, this_len) {
            if (this_len === void 0 || this_len > str.length) {
              this_len = str.length;
            }
            return str.substring(this_len - search.length, this_len) === search;
          }
          function includes(str, search, start) {
            if (typeof start !== "number") {
              start = 0;
            }
            if (start + search.length > str.length) {
              return false;
            } else {
              return str.indexOf(search, start) !== -1;
            }
          }
          createErrorType("ERR_INVALID_OPT_VALUE", function(name, value) {
            return 'The value "' + value + '" is invalid for option "' + name + '"';
          }, TypeError);
          createErrorType("ERR_INVALID_ARG_TYPE", function(name, expected, actual) {
            var determiner;
            if (typeof expected === "string" && startsWith(expected, "not ")) {
              determiner = "must not be";
              expected = expected.replace(/^not /, "");
            } else {
              determiner = "must be";
            }
            var msg;
            if (endsWith(name, " argument")) {
              msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
            } else {
              var type = includes(name, ".") ? "property" : "argument";
              msg = 'The "'.concat(name, '" ').concat(type, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
            }
            msg += ". Received type ".concat(typeof actual);
            return msg;
          }, TypeError);
          createErrorType("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF");
          createErrorType("ERR_METHOD_NOT_IMPLEMENTED", function(name) {
            return "The " + name + " method is not implemented";
          });
          createErrorType("ERR_STREAM_PREMATURE_CLOSE", "Premature close");
          createErrorType("ERR_STREAM_DESTROYED", function(name) {
            return "Cannot call " + name + " after a stream was destroyed";
          });
          createErrorType("ERR_MULTIPLE_CALLBACK", "Callback called multiple times");
          createErrorType("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable");
          createErrorType("ERR_STREAM_WRITE_AFTER_END", "write after end");
          createErrorType("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
          createErrorType("ERR_UNKNOWN_ENCODING", function(arg) {
            return "Unknown encoding: " + arg;
          }, TypeError);
          createErrorType("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event");
          module3.exports.codes = codes;
        }, {}], 67: [function(require2, module3, exports3) {
          (function(process) {
            (function() {
              "use strict";
              var objectKeys = Object.keys || function(obj) {
                var keys2 = [];
                for (var key in obj) {
                  keys2.push(key);
                }
                return keys2;
              };
              module3.exports = Duplex;
              var Readable = require2("./_stream_readable");
              var Writable = require2("./_stream_writable");
              require2("inherits")(Duplex, Readable);
              {
                var keys = objectKeys(Writable.prototype);
                for (var v = 0; v < keys.length; v++) {
                  var method = keys[v];
                  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
                }
              }
              function Duplex(options) {
                if (!(this instanceof Duplex)) return new Duplex(options);
                Readable.call(this, options);
                Writable.call(this, options);
                this.allowHalfOpen = true;
                if (options) {
                  if (options.readable === false) this.readable = false;
                  if (options.writable === false) this.writable = false;
                  if (options.allowHalfOpen === false) {
                    this.allowHalfOpen = false;
                    this.once("end", onend);
                  }
                }
              }
              Object.defineProperty(Duplex.prototype, "writableHighWaterMark", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState.highWaterMark;
                }
              });
              Object.defineProperty(Duplex.prototype, "writableBuffer", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState && this._writableState.getBuffer();
                }
              });
              Object.defineProperty(Duplex.prototype, "writableLength", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState.length;
                }
              });
              function onend() {
                if (this._writableState.ended) return;
                process.nextTick(onEndNT, this);
              }
              function onEndNT(self2) {
                self2.end();
              }
              Object.defineProperty(Duplex.prototype, "destroyed", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  if (this._readableState === void 0 || this._writableState === void 0) {
                    return false;
                  }
                  return this._readableState.destroyed && this._writableState.destroyed;
                },
                set: function set(value) {
                  if (this._readableState === void 0 || this._writableState === void 0) {
                    return;
                  }
                  this._readableState.destroyed = value;
                  this._writableState.destroyed = value;
                }
              });
            }).call(this);
          }).call(this, require2("_process"));
        }, { "./_stream_readable": 69, "./_stream_writable": 71, "_process": 63, "inherits": 46 }], 68: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = PassThrough;
          var Transform = require2("./_stream_transform");
          require2("inherits")(PassThrough, Transform);
          function PassThrough(options) {
            if (!(this instanceof PassThrough)) return new PassThrough(options);
            Transform.call(this, options);
          }
          PassThrough.prototype._transform = function(chunk, encoding, cb) {
            cb(null, chunk);
          };
        }, { "./_stream_transform": 70, "inherits": 46 }], 69: [function(require2, module3, exports3) {
          (function(process, global2) {
            (function() {
              "use strict";
              module3.exports = Readable;
              var Duplex;
              Readable.ReadableState = ReadableState;
              var EE = require2("events").EventEmitter;
              var EElistenerCount = function EElistenerCount2(emitter, type) {
                return emitter.listeners(type).length;
              };
              var Stream = require2("./internal/streams/stream");
              var Buffer2 = require2("buffer").Buffer;
              var OurUint8Array = global2.Uint8Array || function() {
              };
              function _uint8ArrayToBuffer(chunk) {
                return Buffer2.from(chunk);
              }
              function _isUint8Array(obj) {
                return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
              }
              var debugUtil = require2("util");
              var debug;
              if (debugUtil && debugUtil.debuglog) {
                debug = debugUtil.debuglog("stream");
              } else {
                debug = function debug2() {
                };
              }
              var BufferList = require2("./internal/streams/buffer_list");
              var destroyImpl = require2("./internal/streams/destroy");
              var _require = require2("./internal/streams/state"), getHighWaterMark = _require.getHighWaterMark;
              var _require$codes = require2("../errors").codes, ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE, ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF, ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED, ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;
              var StringDecoder;
              var createReadableStreamAsyncIterator;
              var from;
              require2("inherits")(Readable, Stream);
              var errorOrDestroy = destroyImpl.errorOrDestroy;
              var kProxyEvents = ["error", "close", "destroy", "pause", "resume"];
              function prependListener(emitter, event, fn) {
                if (typeof emitter.prependListener === "function") return emitter.prependListener(event, fn);
                if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);
                else if (Array.isArray(emitter._events[event])) emitter._events[event].unshift(fn);
                else emitter._events[event] = [fn, emitter._events[event]];
              }
              function ReadableState(options, stream, isDuplex) {
                Duplex = Duplex || require2("./_stream_duplex");
                options = options || {};
                if (typeof isDuplex !== "boolean") isDuplex = stream instanceof Duplex;
                this.objectMode = !!options.objectMode;
                if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode;
                this.highWaterMark = getHighWaterMark(this, options, "readableHighWaterMark", isDuplex);
                this.buffer = new BufferList();
                this.length = 0;
                this.pipes = null;
                this.pipesCount = 0;
                this.flowing = null;
                this.ended = false;
                this.endEmitted = false;
                this.reading = false;
                this.sync = true;
                this.needReadable = false;
                this.emittedReadable = false;
                this.readableListening = false;
                this.resumeScheduled = false;
                this.paused = true;
                this.emitClose = options.emitClose !== false;
                this.autoDestroy = !!options.autoDestroy;
                this.destroyed = false;
                this.defaultEncoding = options.defaultEncoding || "utf8";
                this.awaitDrain = 0;
                this.readingMore = false;
                this.decoder = null;
                this.encoding = null;
                if (options.encoding) {
                  if (!StringDecoder) StringDecoder = require2("string_decoder/").StringDecoder;
                  this.decoder = new StringDecoder(options.encoding);
                  this.encoding = options.encoding;
                }
              }
              function Readable(options) {
                Duplex = Duplex || require2("./_stream_duplex");
                if (!(this instanceof Readable)) return new Readable(options);
                var isDuplex = this instanceof Duplex;
                this._readableState = new ReadableState(options, this, isDuplex);
                this.readable = true;
                if (options) {
                  if (typeof options.read === "function") this._read = options.read;
                  if (typeof options.destroy === "function") this._destroy = options.destroy;
                }
                Stream.call(this);
              }
              Object.defineProperty(Readable.prototype, "destroyed", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  if (this._readableState === void 0) {
                    return false;
                  }
                  return this._readableState.destroyed;
                },
                set: function set(value) {
                  if (!this._readableState) {
                    return;
                  }
                  this._readableState.destroyed = value;
                }
              });
              Readable.prototype.destroy = destroyImpl.destroy;
              Readable.prototype._undestroy = destroyImpl.undestroy;
              Readable.prototype._destroy = function(err, cb) {
                cb(err);
              };
              Readable.prototype.push = function(chunk, encoding) {
                var state = this._readableState;
                var skipChunkCheck;
                if (!state.objectMode) {
                  if (typeof chunk === "string") {
                    encoding = encoding || state.defaultEncoding;
                    if (encoding !== state.encoding) {
                      chunk = Buffer2.from(chunk, encoding);
                      encoding = "";
                    }
                    skipChunkCheck = true;
                  }
                } else {
                  skipChunkCheck = true;
                }
                return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
              };
              Readable.prototype.unshift = function(chunk) {
                return readableAddChunk(this, chunk, null, true, false);
              };
              function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
                debug("readableAddChunk", chunk);
                var state = stream._readableState;
                if (chunk === null) {
                  state.reading = false;
                  onEofChunk(stream, state);
                } else {
                  var er;
                  if (!skipChunkCheck) er = chunkInvalid(state, chunk);
                  if (er) {
                    errorOrDestroy(stream, er);
                  } else if (state.objectMode || chunk && chunk.length > 0) {
                    if (typeof chunk !== "string" && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer2.prototype) {
                      chunk = _uint8ArrayToBuffer(chunk);
                    }
                    if (addToFront) {
                      if (state.endEmitted) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
                      else addChunk(stream, state, chunk, true);
                    } else if (state.ended) {
                      errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
                    } else if (state.destroyed) {
                      return false;
                    } else {
                      state.reading = false;
                      if (state.decoder && !encoding) {
                        chunk = state.decoder.write(chunk);
                        if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);
                        else maybeReadMore(stream, state);
                      } else {
                        addChunk(stream, state, chunk, false);
                      }
                    }
                  } else if (!addToFront) {
                    state.reading = false;
                    maybeReadMore(stream, state);
                  }
                }
                return !state.ended && (state.length < state.highWaterMark || state.length === 0);
              }
              function addChunk(stream, state, chunk, addToFront) {
                if (state.flowing && state.length === 0 && !state.sync) {
                  state.awaitDrain = 0;
                  stream.emit("data", chunk);
                } else {
                  state.length += state.objectMode ? 1 : chunk.length;
                  if (addToFront) state.buffer.unshift(chunk);
                  else state.buffer.push(chunk);
                  if (state.needReadable) emitReadable(stream);
                }
                maybeReadMore(stream, state);
              }
              function chunkInvalid(state, chunk) {
                var er;
                if (!_isUint8Array(chunk) && typeof chunk !== "string" && chunk !== void 0 && !state.objectMode) {
                  er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
                }
                return er;
              }
              Readable.prototype.isPaused = function() {
                return this._readableState.flowing === false;
              };
              Readable.prototype.setEncoding = function(enc) {
                if (!StringDecoder) StringDecoder = require2("string_decoder/").StringDecoder;
                var decoder = new StringDecoder(enc);
                this._readableState.decoder = decoder;
                this._readableState.encoding = this._readableState.decoder.encoding;
                var p = this._readableState.buffer.head;
                var content = "";
                while (p !== null) {
                  content += decoder.write(p.data);
                  p = p.next;
                }
                this._readableState.buffer.clear();
                if (content !== "") this._readableState.buffer.push(content);
                this._readableState.length = content.length;
                return this;
              };
              var MAX_HWM = 1073741824;
              function computeNewHighWaterMark(n) {
                if (n >= MAX_HWM) {
                  n = MAX_HWM;
                } else {
                  n--;
                  n |= n >>> 1;
                  n |= n >>> 2;
                  n |= n >>> 4;
                  n |= n >>> 8;
                  n |= n >>> 16;
                  n++;
                }
                return n;
              }
              function howMuchToRead(n, state) {
                if (n <= 0 || state.length === 0 && state.ended) return 0;
                if (state.objectMode) return 1;
                if (n !== n) {
                  if (state.flowing && state.length) return state.buffer.head.data.length;
                  else return state.length;
                }
                if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
                if (n <= state.length) return n;
                if (!state.ended) {
                  state.needReadable = true;
                  return 0;
                }
                return state.length;
              }
              Readable.prototype.read = function(n) {
                debug("read", n);
                n = parseInt(n, 10);
                var state = this._readableState;
                var nOrig = n;
                if (n !== 0) state.emittedReadable = false;
                if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
                  debug("read: emitReadable", state.length, state.ended);
                  if (state.length === 0 && state.ended) endReadable(this);
                  else emitReadable(this);
                  return null;
                }
                n = howMuchToRead(n, state);
                if (n === 0 && state.ended) {
                  if (state.length === 0) endReadable(this);
                  return null;
                }
                var doRead = state.needReadable;
                debug("need readable", doRead);
                if (state.length === 0 || state.length - n < state.highWaterMark) {
                  doRead = true;
                  debug("length less than watermark", doRead);
                }
                if (state.ended || state.reading) {
                  doRead = false;
                  debug("reading or ended", doRead);
                } else if (doRead) {
                  debug("do read");
                  state.reading = true;
                  state.sync = true;
                  if (state.length === 0) state.needReadable = true;
                  this._read(state.highWaterMark);
                  state.sync = false;
                  if (!state.reading) n = howMuchToRead(nOrig, state);
                }
                var ret;
                if (n > 0) ret = fromList(n, state);
                else ret = null;
                if (ret === null) {
                  state.needReadable = state.length <= state.highWaterMark;
                  n = 0;
                } else {
                  state.length -= n;
                  state.awaitDrain = 0;
                }
                if (state.length === 0) {
                  if (!state.ended) state.needReadable = true;
                  if (nOrig !== n && state.ended) endReadable(this);
                }
                if (ret !== null) this.emit("data", ret);
                return ret;
              };
              function onEofChunk(stream, state) {
                debug("onEofChunk");
                if (state.ended) return;
                if (state.decoder) {
                  var chunk = state.decoder.end();
                  if (chunk && chunk.length) {
                    state.buffer.push(chunk);
                    state.length += state.objectMode ? 1 : chunk.length;
                  }
                }
                state.ended = true;
                if (state.sync) {
                  emitReadable(stream);
                } else {
                  state.needReadable = false;
                  if (!state.emittedReadable) {
                    state.emittedReadable = true;
                    emitReadable_(stream);
                  }
                }
              }
              function emitReadable(stream) {
                var state = stream._readableState;
                debug("emitReadable", state.needReadable, state.emittedReadable);
                state.needReadable = false;
                if (!state.emittedReadable) {
                  debug("emitReadable", state.flowing);
                  state.emittedReadable = true;
                  process.nextTick(emitReadable_, stream);
                }
              }
              function emitReadable_(stream) {
                var state = stream._readableState;
                debug("emitReadable_", state.destroyed, state.length, state.ended);
                if (!state.destroyed && (state.length || state.ended)) {
                  stream.emit("readable");
                  state.emittedReadable = false;
                }
                state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
                flow(stream);
              }
              function maybeReadMore(stream, state) {
                if (!state.readingMore) {
                  state.readingMore = true;
                  process.nextTick(maybeReadMore_, stream, state);
                }
              }
              function maybeReadMore_(stream, state) {
                while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
                  var len = state.length;
                  debug("maybeReadMore read 0");
                  stream.read(0);
                  if (len === state.length)
                    break;
                }
                state.readingMore = false;
              }
              Readable.prototype._read = function(n) {
                errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED("_read()"));
              };
              Readable.prototype.pipe = function(dest, pipeOpts) {
                var src = this;
                var state = this._readableState;
                switch (state.pipesCount) {
                  case 0:
                    state.pipes = dest;
                    break;
                  case 1:
                    state.pipes = [state.pipes, dest];
                    break;
                  default:
                    state.pipes.push(dest);
                    break;
                }
                state.pipesCount += 1;
                debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
                var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
                var endFn = doEnd ? onend : unpipe;
                if (state.endEmitted) process.nextTick(endFn);
                else src.once("end", endFn);
                dest.on("unpipe", onunpipe);
                function onunpipe(readable, unpipeInfo) {
                  debug("onunpipe");
                  if (readable === src) {
                    if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
                      unpipeInfo.hasUnpiped = true;
                      cleanup();
                    }
                  }
                }
                function onend() {
                  debug("onend");
                  dest.end();
                }
                var ondrain = pipeOnDrain(src);
                dest.on("drain", ondrain);
                var cleanedUp = false;
                function cleanup() {
                  debug("cleanup");
                  dest.removeListener("close", onclose);
                  dest.removeListener("finish", onfinish);
                  dest.removeListener("drain", ondrain);
                  dest.removeListener("error", onerror);
                  dest.removeListener("unpipe", onunpipe);
                  src.removeListener("end", onend);
                  src.removeListener("end", unpipe);
                  src.removeListener("data", ondata);
                  cleanedUp = true;
                  if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
                }
                src.on("data", ondata);
                function ondata(chunk) {
                  debug("ondata");
                  var ret = dest.write(chunk);
                  debug("dest.write", ret);
                  if (ret === false) {
                    if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
                      debug("false write response, pause", state.awaitDrain);
                      state.awaitDrain++;
                    }
                    src.pause();
                  }
                }
                function onerror(er) {
                  debug("onerror", er);
                  unpipe();
                  dest.removeListener("error", onerror);
                  if (EElistenerCount(dest, "error") === 0) errorOrDestroy(dest, er);
                }
                prependListener(dest, "error", onerror);
                function onclose() {
                  dest.removeListener("finish", onfinish);
                  unpipe();
                }
                dest.once("close", onclose);
                function onfinish() {
                  debug("onfinish");
                  dest.removeListener("close", onclose);
                  unpipe();
                }
                dest.once("finish", onfinish);
                function unpipe() {
                  debug("unpipe");
                  src.unpipe(dest);
                }
                dest.emit("pipe", src);
                if (!state.flowing) {
                  debug("pipe resume");
                  src.resume();
                }
                return dest;
              };
              function pipeOnDrain(src) {
                return function pipeOnDrainFunctionResult() {
                  var state = src._readableState;
                  debug("pipeOnDrain", state.awaitDrain);
                  if (state.awaitDrain) state.awaitDrain--;
                  if (state.awaitDrain === 0 && EElistenerCount(src, "data")) {
                    state.flowing = true;
                    flow(src);
                  }
                };
              }
              Readable.prototype.unpipe = function(dest) {
                var state = this._readableState;
                var unpipeInfo = {
                  hasUnpiped: false
                };
                if (state.pipesCount === 0) return this;
                if (state.pipesCount === 1) {
                  if (dest && dest !== state.pipes) return this;
                  if (!dest) dest = state.pipes;
                  state.pipes = null;
                  state.pipesCount = 0;
                  state.flowing = false;
                  if (dest) dest.emit("unpipe", this, unpipeInfo);
                  return this;
                }
                if (!dest) {
                  var dests = state.pipes;
                  var len = state.pipesCount;
                  state.pipes = null;
                  state.pipesCount = 0;
                  state.flowing = false;
                  for (var i = 0; i < len; i++) {
                    dests[i].emit("unpipe", this, {
                      hasUnpiped: false
                    });
                  }
                  return this;
                }
                var index = indexOf(state.pipes, dest);
                if (index === -1) return this;
                state.pipes.splice(index, 1);
                state.pipesCount -= 1;
                if (state.pipesCount === 1) state.pipes = state.pipes[0];
                dest.emit("unpipe", this, unpipeInfo);
                return this;
              };
              Readable.prototype.on = function(ev, fn) {
                var res = Stream.prototype.on.call(this, ev, fn);
                var state = this._readableState;
                if (ev === "data") {
                  state.readableListening = this.listenerCount("readable") > 0;
                  if (state.flowing !== false) this.resume();
                } else if (ev === "readable") {
                  if (!state.endEmitted && !state.readableListening) {
                    state.readableListening = state.needReadable = true;
                    state.flowing = false;
                    state.emittedReadable = false;
                    debug("on readable", state.length, state.reading);
                    if (state.length) {
                      emitReadable(this);
                    } else if (!state.reading) {
                      process.nextTick(nReadingNextTick, this);
                    }
                  }
                }
                return res;
              };
              Readable.prototype.addListener = Readable.prototype.on;
              Readable.prototype.removeListener = function(ev, fn) {
                var res = Stream.prototype.removeListener.call(this, ev, fn);
                if (ev === "readable") {
                  process.nextTick(updateReadableListening, this);
                }
                return res;
              };
              Readable.prototype.removeAllListeners = function(ev) {
                var res = Stream.prototype.removeAllListeners.apply(this, arguments);
                if (ev === "readable" || ev === void 0) {
                  process.nextTick(updateReadableListening, this);
                }
                return res;
              };
              function updateReadableListening(self2) {
                var state = self2._readableState;
                state.readableListening = self2.listenerCount("readable") > 0;
                if (state.resumeScheduled && !state.paused) {
                  state.flowing = true;
                } else if (self2.listenerCount("data") > 0) {
                  self2.resume();
                }
              }
              function nReadingNextTick(self2) {
                debug("readable nexttick read 0");
                self2.read(0);
              }
              Readable.prototype.resume = function() {
                var state = this._readableState;
                if (!state.flowing) {
                  debug("resume");
                  state.flowing = !state.readableListening;
                  resume(this, state);
                }
                state.paused = false;
                return this;
              };
              function resume(stream, state) {
                if (!state.resumeScheduled) {
                  state.resumeScheduled = true;
                  process.nextTick(resume_, stream, state);
                }
              }
              function resume_(stream, state) {
                debug("resume", state.reading);
                if (!state.reading) {
                  stream.read(0);
                }
                state.resumeScheduled = false;
                stream.emit("resume");
                flow(stream);
                if (state.flowing && !state.reading) stream.read(0);
              }
              Readable.prototype.pause = function() {
                debug("call pause flowing=%j", this._readableState.flowing);
                if (this._readableState.flowing !== false) {
                  debug("pause");
                  this._readableState.flowing = false;
                  this.emit("pause");
                }
                this._readableState.paused = true;
                return this;
              };
              function flow(stream) {
                var state = stream._readableState;
                debug("flow", state.flowing);
                while (state.flowing && stream.read() !== null) {
                  ;
                }
              }
              Readable.prototype.wrap = function(stream) {
                var _this = this;
                var state = this._readableState;
                var paused = false;
                stream.on("end", function() {
                  debug("wrapped end");
                  if (state.decoder && !state.ended) {
                    var chunk = state.decoder.end();
                    if (chunk && chunk.length) _this.push(chunk);
                  }
                  _this.push(null);
                });
                stream.on("data", function(chunk) {
                  debug("wrapped data");
                  if (state.decoder) chunk = state.decoder.write(chunk);
                  if (state.objectMode && (chunk === null || chunk === void 0)) return;
                  else if (!state.objectMode && (!chunk || !chunk.length)) return;
                  var ret = _this.push(chunk);
                  if (!ret) {
                    paused = true;
                    stream.pause();
                  }
                });
                for (var i in stream) {
                  if (this[i] === void 0 && typeof stream[i] === "function") {
                    this[i] = /* @__PURE__ */ function methodWrap(method) {
                      return function methodWrapReturnFunction() {
                        return stream[method].apply(stream, arguments);
                      };
                    }(i);
                  }
                }
                for (var n = 0; n < kProxyEvents.length; n++) {
                  stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
                }
                this._read = function(n2) {
                  debug("wrapped _read", n2);
                  if (paused) {
                    paused = false;
                    stream.resume();
                  }
                };
                return this;
              };
              if (typeof Symbol === "function") {
                Readable.prototype[Symbol.asyncIterator] = function() {
                  if (createReadableStreamAsyncIterator === void 0) {
                    createReadableStreamAsyncIterator = require2("./internal/streams/async_iterator");
                  }
                  return createReadableStreamAsyncIterator(this);
                };
              }
              Object.defineProperty(Readable.prototype, "readableHighWaterMark", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._readableState.highWaterMark;
                }
              });
              Object.defineProperty(Readable.prototype, "readableBuffer", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._readableState && this._readableState.buffer;
                }
              });
              Object.defineProperty(Readable.prototype, "readableFlowing", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._readableState.flowing;
                },
                set: function set(state) {
                  if (this._readableState) {
                    this._readableState.flowing = state;
                  }
                }
              });
              Readable._fromList = fromList;
              Object.defineProperty(Readable.prototype, "readableLength", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._readableState.length;
                }
              });
              function fromList(n, state) {
                if (state.length === 0) return null;
                var ret;
                if (state.objectMode) ret = state.buffer.shift();
                else if (!n || n >= state.length) {
                  if (state.decoder) ret = state.buffer.join("");
                  else if (state.buffer.length === 1) ret = state.buffer.first();
                  else ret = state.buffer.concat(state.length);
                  state.buffer.clear();
                } else {
                  ret = state.buffer.consume(n, state.decoder);
                }
                return ret;
              }
              function endReadable(stream) {
                var state = stream._readableState;
                debug("endReadable", state.endEmitted);
                if (!state.endEmitted) {
                  state.ended = true;
                  process.nextTick(endReadableNT, state, stream);
                }
              }
              function endReadableNT(state, stream) {
                debug("endReadableNT", state.endEmitted, state.length);
                if (!state.endEmitted && state.length === 0) {
                  state.endEmitted = true;
                  stream.readable = false;
                  stream.emit("end");
                  if (state.autoDestroy) {
                    var wState = stream._writableState;
                    if (!wState || wState.autoDestroy && wState.finished) {
                      stream.destroy();
                    }
                  }
                }
              }
              if (typeof Symbol === "function") {
                Readable.from = function(iterable, opts) {
                  if (from === void 0) {
                    from = require2("./internal/streams/from");
                  }
                  return from(Readable, iterable, opts);
                };
              }
              function indexOf(xs, x) {
                for (var i = 0, l = xs.length; i < l; i++) {
                  if (xs[i] === x) return i;
                }
                return -1;
              }
            }).call(this);
          }).call(this, require2("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "../errors": 66, "./_stream_duplex": 67, "./internal/streams/async_iterator": 72, "./internal/streams/buffer_list": 73, "./internal/streams/destroy": 74, "./internal/streams/from": 76, "./internal/streams/state": 78, "./internal/streams/stream": 79, "_process": 63, "buffer": 32, "events": 35, "inherits": 46, "string_decoder/": 80, "util": 29 }], 70: [function(require2, module3, exports3) {
          "use strict";
          module3.exports = Transform;
          var _require$codes = require2("../errors").codes, ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED, ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK, ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING, ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;
          var Duplex = require2("./_stream_duplex");
          require2("inherits")(Transform, Duplex);
          function afterTransform(er, data) {
            var ts = this._transformState;
            ts.transforming = false;
            var cb = ts.writecb;
            if (cb === null) {
              return this.emit("error", new ERR_MULTIPLE_CALLBACK());
            }
            ts.writechunk = null;
            ts.writecb = null;
            if (data != null)
              this.push(data);
            cb(er);
            var rs = this._readableState;
            rs.reading = false;
            if (rs.needReadable || rs.length < rs.highWaterMark) {
              this._read(rs.highWaterMark);
            }
          }
          function Transform(options) {
            if (!(this instanceof Transform)) return new Transform(options);
            Duplex.call(this, options);
            this._transformState = {
              afterTransform: afterTransform.bind(this),
              needTransform: false,
              transforming: false,
              writecb: null,
              writechunk: null,
              writeencoding: null
            };
            this._readableState.needReadable = true;
            this._readableState.sync = false;
            if (options) {
              if (typeof options.transform === "function") this._transform = options.transform;
              if (typeof options.flush === "function") this._flush = options.flush;
            }
            this.on("prefinish", prefinish);
          }
          function prefinish() {
            var _this = this;
            if (typeof this._flush === "function" && !this._readableState.destroyed) {
              this._flush(function(er, data) {
                done(_this, er, data);
              });
            } else {
              done(this, null, null);
            }
          }
          Transform.prototype.push = function(chunk, encoding) {
            this._transformState.needTransform = false;
            return Duplex.prototype.push.call(this, chunk, encoding);
          };
          Transform.prototype._transform = function(chunk, encoding, cb) {
            cb(new ERR_METHOD_NOT_IMPLEMENTED("_transform()"));
          };
          Transform.prototype._write = function(chunk, encoding, cb) {
            var ts = this._transformState;
            ts.writecb = cb;
            ts.writechunk = chunk;
            ts.writeencoding = encoding;
            if (!ts.transforming) {
              var rs = this._readableState;
              if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
            }
          };
          Transform.prototype._read = function(n) {
            var ts = this._transformState;
            if (ts.writechunk !== null && !ts.transforming) {
              ts.transforming = true;
              this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
            } else {
              ts.needTransform = true;
            }
          };
          Transform.prototype._destroy = function(err, cb) {
            Duplex.prototype._destroy.call(this, err, function(err2) {
              cb(err2);
            });
          };
          function done(stream, er, data) {
            if (er) return stream.emit("error", er);
            if (data != null)
              stream.push(data);
            if (stream._writableState.length) throw new ERR_TRANSFORM_WITH_LENGTH_0();
            if (stream._transformState.transforming) throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
            return stream.push(null);
          }
        }, { "../errors": 66, "./_stream_duplex": 67, "inherits": 46 }], 71: [function(require2, module3, exports3) {
          (function(process, global2) {
            (function() {
              "use strict";
              module3.exports = Writable;
              function WriteReq(chunk, encoding, cb) {
                this.chunk = chunk;
                this.encoding = encoding;
                this.callback = cb;
                this.next = null;
              }
              function CorkedRequest(state) {
                var _this = this;
                this.next = null;
                this.entry = null;
                this.finish = function() {
                  onCorkedFinish(_this, state);
                };
              }
              var Duplex;
              Writable.WritableState = WritableState;
              var internalUtil = {
                deprecate: require2("util-deprecate")
              };
              var Stream = require2("./internal/streams/stream");
              var Buffer2 = require2("buffer").Buffer;
              var OurUint8Array = global2.Uint8Array || function() {
              };
              function _uint8ArrayToBuffer(chunk) {
                return Buffer2.from(chunk);
              }
              function _isUint8Array(obj) {
                return Buffer2.isBuffer(obj) || obj instanceof OurUint8Array;
              }
              var destroyImpl = require2("./internal/streams/destroy");
              var _require = require2("./internal/streams/state"), getHighWaterMark = _require.getHighWaterMark;
              var _require$codes = require2("../errors").codes, ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE, ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED, ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK, ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE, ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED, ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES, ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END, ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;
              var errorOrDestroy = destroyImpl.errorOrDestroy;
              require2("inherits")(Writable, Stream);
              function nop() {
              }
              function WritableState(options, stream, isDuplex) {
                Duplex = Duplex || require2("./_stream_duplex");
                options = options || {};
                if (typeof isDuplex !== "boolean") isDuplex = stream instanceof Duplex;
                this.objectMode = !!options.objectMode;
                if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode;
                this.highWaterMark = getHighWaterMark(this, options, "writableHighWaterMark", isDuplex);
                this.finalCalled = false;
                this.needDrain = false;
                this.ending = false;
                this.ended = false;
                this.finished = false;
                this.destroyed = false;
                var noDecode = options.decodeStrings === false;
                this.decodeStrings = !noDecode;
                this.defaultEncoding = options.defaultEncoding || "utf8";
                this.length = 0;
                this.writing = false;
                this.corked = 0;
                this.sync = true;
                this.bufferProcessing = false;
                this.onwrite = function(er) {
                  onwrite(stream, er);
                };
                this.writecb = null;
                this.writelen = 0;
                this.bufferedRequest = null;
                this.lastBufferedRequest = null;
                this.pendingcb = 0;
                this.prefinished = false;
                this.errorEmitted = false;
                this.emitClose = options.emitClose !== false;
                this.autoDestroy = !!options.autoDestroy;
                this.bufferedRequestCount = 0;
                this.corkedRequestsFree = new CorkedRequest(this);
              }
              WritableState.prototype.getBuffer = function getBuffer() {
                var current = this.bufferedRequest;
                var out = [];
                while (current) {
                  out.push(current);
                  current = current.next;
                }
                return out;
              };
              (function() {
                try {
                  Object.defineProperty(WritableState.prototype, "buffer", {
                    get: internalUtil.deprecate(function writableStateBufferGetter() {
                      return this.getBuffer();
                    }, "_writableState.buffer is deprecated. Use _writableState.getBuffer instead.", "DEP0003")
                  });
                } catch (_) {
                }
              })();
              var realHasInstance;
              if (typeof Symbol === "function" && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === "function") {
                realHasInstance = Function.prototype[Symbol.hasInstance];
                Object.defineProperty(Writable, Symbol.hasInstance, {
                  value: function value(object) {
                    if (realHasInstance.call(this, object)) return true;
                    if (this !== Writable) return false;
                    return object && object._writableState instanceof WritableState;
                  }
                });
              } else {
                realHasInstance = function realHasInstance2(object) {
                  return object instanceof this;
                };
              }
              function Writable(options) {
                Duplex = Duplex || require2("./_stream_duplex");
                var isDuplex = this instanceof Duplex;
                if (!isDuplex && !realHasInstance.call(Writable, this)) return new Writable(options);
                this._writableState = new WritableState(options, this, isDuplex);
                this.writable = true;
                if (options) {
                  if (typeof options.write === "function") this._write = options.write;
                  if (typeof options.writev === "function") this._writev = options.writev;
                  if (typeof options.destroy === "function") this._destroy = options.destroy;
                  if (typeof options.final === "function") this._final = options.final;
                }
                Stream.call(this);
              }
              Writable.prototype.pipe = function() {
                errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
              };
              function writeAfterEnd(stream, cb) {
                var er = new ERR_STREAM_WRITE_AFTER_END();
                errorOrDestroy(stream, er);
                process.nextTick(cb, er);
              }
              function validChunk(stream, state, chunk, cb) {
                var er;
                if (chunk === null) {
                  er = new ERR_STREAM_NULL_VALUES();
                } else if (typeof chunk !== "string" && !state.objectMode) {
                  er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer"], chunk);
                }
                if (er) {
                  errorOrDestroy(stream, er);
                  process.nextTick(cb, er);
                  return false;
                }
                return true;
              }
              Writable.prototype.write = function(chunk, encoding, cb) {
                var state = this._writableState;
                var ret = false;
                var isBuf = !state.objectMode && _isUint8Array(chunk);
                if (isBuf && !Buffer2.isBuffer(chunk)) {
                  chunk = _uint8ArrayToBuffer(chunk);
                }
                if (typeof encoding === "function") {
                  cb = encoding;
                  encoding = null;
                }
                if (isBuf) encoding = "buffer";
                else if (!encoding) encoding = state.defaultEncoding;
                if (typeof cb !== "function") cb = nop;
                if (state.ending) writeAfterEnd(this, cb);
                else if (isBuf || validChunk(this, state, chunk, cb)) {
                  state.pendingcb++;
                  ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
                }
                return ret;
              };
              Writable.prototype.cork = function() {
                this._writableState.corked++;
              };
              Writable.prototype.uncork = function() {
                var state = this._writableState;
                if (state.corked) {
                  state.corked--;
                  if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
                }
              };
              Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
                if (typeof encoding === "string") encoding = encoding.toLowerCase();
                if (!(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((encoding + "").toLowerCase()) > -1)) throw new ERR_UNKNOWN_ENCODING(encoding);
                this._writableState.defaultEncoding = encoding;
                return this;
              };
              Object.defineProperty(Writable.prototype, "writableBuffer", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState && this._writableState.getBuffer();
                }
              });
              function decodeChunk(state, chunk, encoding) {
                if (!state.objectMode && state.decodeStrings !== false && typeof chunk === "string") {
                  chunk = Buffer2.from(chunk, encoding);
                }
                return chunk;
              }
              Object.defineProperty(Writable.prototype, "writableHighWaterMark", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState.highWaterMark;
                }
              });
              function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
                if (!isBuf) {
                  var newChunk = decodeChunk(state, chunk, encoding);
                  if (chunk !== newChunk) {
                    isBuf = true;
                    encoding = "buffer";
                    chunk = newChunk;
                  }
                }
                var len = state.objectMode ? 1 : chunk.length;
                state.length += len;
                var ret = state.length < state.highWaterMark;
                if (!ret) state.needDrain = true;
                if (state.writing || state.corked) {
                  var last = state.lastBufferedRequest;
                  state.lastBufferedRequest = {
                    chunk,
                    encoding,
                    isBuf,
                    callback: cb,
                    next: null
                  };
                  if (last) {
                    last.next = state.lastBufferedRequest;
                  } else {
                    state.bufferedRequest = state.lastBufferedRequest;
                  }
                  state.bufferedRequestCount += 1;
                } else {
                  doWrite(stream, state, false, len, chunk, encoding, cb);
                }
                return ret;
              }
              function doWrite(stream, state, writev, len, chunk, encoding, cb) {
                state.writelen = len;
                state.writecb = cb;
                state.writing = true;
                state.sync = true;
                if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED("write"));
                else if (writev) stream._writev(chunk, state.onwrite);
                else stream._write(chunk, encoding, state.onwrite);
                state.sync = false;
              }
              function onwriteError(stream, state, sync, er, cb) {
                --state.pendingcb;
                if (sync) {
                  process.nextTick(cb, er);
                  process.nextTick(finishMaybe, stream, state);
                  stream._writableState.errorEmitted = true;
                  errorOrDestroy(stream, er);
                } else {
                  cb(er);
                  stream._writableState.errorEmitted = true;
                  errorOrDestroy(stream, er);
                  finishMaybe(stream, state);
                }
              }
              function onwriteStateUpdate(state) {
                state.writing = false;
                state.writecb = null;
                state.length -= state.writelen;
                state.writelen = 0;
              }
              function onwrite(stream, er) {
                var state = stream._writableState;
                var sync = state.sync;
                var cb = state.writecb;
                if (typeof cb !== "function") throw new ERR_MULTIPLE_CALLBACK();
                onwriteStateUpdate(state);
                if (er) onwriteError(stream, state, sync, er, cb);
                else {
                  var finished = needFinish(state) || stream.destroyed;
                  if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
                    clearBuffer(stream, state);
                  }
                  if (sync) {
                    process.nextTick(afterWrite, stream, state, finished, cb);
                  } else {
                    afterWrite(stream, state, finished, cb);
                  }
                }
              }
              function afterWrite(stream, state, finished, cb) {
                if (!finished) onwriteDrain(stream, state);
                state.pendingcb--;
                cb();
                finishMaybe(stream, state);
              }
              function onwriteDrain(stream, state) {
                if (state.length === 0 && state.needDrain) {
                  state.needDrain = false;
                  stream.emit("drain");
                }
              }
              function clearBuffer(stream, state) {
                state.bufferProcessing = true;
                var entry = state.bufferedRequest;
                if (stream._writev && entry && entry.next) {
                  var l = state.bufferedRequestCount;
                  var buffer = new Array(l);
                  var holder = state.corkedRequestsFree;
                  holder.entry = entry;
                  var count = 0;
                  var allBuffers = true;
                  while (entry) {
                    buffer[count] = entry;
                    if (!entry.isBuf) allBuffers = false;
                    entry = entry.next;
                    count += 1;
                  }
                  buffer.allBuffers = allBuffers;
                  doWrite(stream, state, true, state.length, buffer, "", holder.finish);
                  state.pendingcb++;
                  state.lastBufferedRequest = null;
                  if (holder.next) {
                    state.corkedRequestsFree = holder.next;
                    holder.next = null;
                  } else {
                    state.corkedRequestsFree = new CorkedRequest(state);
                  }
                  state.bufferedRequestCount = 0;
                } else {
                  while (entry) {
                    var chunk = entry.chunk;
                    var encoding = entry.encoding;
                    var cb = entry.callback;
                    var len = state.objectMode ? 1 : chunk.length;
                    doWrite(stream, state, false, len, chunk, encoding, cb);
                    entry = entry.next;
                    state.bufferedRequestCount--;
                    if (state.writing) {
                      break;
                    }
                  }
                  if (entry === null) state.lastBufferedRequest = null;
                }
                state.bufferedRequest = entry;
                state.bufferProcessing = false;
              }
              Writable.prototype._write = function(chunk, encoding, cb) {
                cb(new ERR_METHOD_NOT_IMPLEMENTED("_write()"));
              };
              Writable.prototype._writev = null;
              Writable.prototype.end = function(chunk, encoding, cb) {
                var state = this._writableState;
                if (typeof chunk === "function") {
                  cb = chunk;
                  chunk = null;
                  encoding = null;
                } else if (typeof encoding === "function") {
                  cb = encoding;
                  encoding = null;
                }
                if (chunk !== null && chunk !== void 0) this.write(chunk, encoding);
                if (state.corked) {
                  state.corked = 1;
                  this.uncork();
                }
                if (!state.ending) endWritable(this, state, cb);
                return this;
              };
              Object.defineProperty(Writable.prototype, "writableLength", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  return this._writableState.length;
                }
              });
              function needFinish(state) {
                return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
              }
              function callFinal(stream, state) {
                stream._final(function(err) {
                  state.pendingcb--;
                  if (err) {
                    errorOrDestroy(stream, err);
                  }
                  state.prefinished = true;
                  stream.emit("prefinish");
                  finishMaybe(stream, state);
                });
              }
              function prefinish(stream, state) {
                if (!state.prefinished && !state.finalCalled) {
                  if (typeof stream._final === "function" && !state.destroyed) {
                    state.pendingcb++;
                    state.finalCalled = true;
                    process.nextTick(callFinal, stream, state);
                  } else {
                    state.prefinished = true;
                    stream.emit("prefinish");
                  }
                }
              }
              function finishMaybe(stream, state) {
                var need = needFinish(state);
                if (need) {
                  prefinish(stream, state);
                  if (state.pendingcb === 0) {
                    state.finished = true;
                    stream.emit("finish");
                    if (state.autoDestroy) {
                      var rState = stream._readableState;
                      if (!rState || rState.autoDestroy && rState.endEmitted) {
                        stream.destroy();
                      }
                    }
                  }
                }
                return need;
              }
              function endWritable(stream, state, cb) {
                state.ending = true;
                finishMaybe(stream, state);
                if (cb) {
                  if (state.finished) process.nextTick(cb);
                  else stream.once("finish", cb);
                }
                state.ended = true;
                stream.writable = false;
              }
              function onCorkedFinish(corkReq, state, err) {
                var entry = corkReq.entry;
                corkReq.entry = null;
                while (entry) {
                  var cb = entry.callback;
                  state.pendingcb--;
                  cb(err);
                  entry = entry.next;
                }
                state.corkedRequestsFree.next = corkReq;
              }
              Object.defineProperty(Writable.prototype, "destroyed", {
                // making it explicit this property is not enumerable
                // because otherwise some prototype manipulation in
                // userland will fail
                enumerable: false,
                get: function get() {
                  if (this._writableState === void 0) {
                    return false;
                  }
                  return this._writableState.destroyed;
                },
                set: function set(value) {
                  if (!this._writableState) {
                    return;
                  }
                  this._writableState.destroyed = value;
                }
              });
              Writable.prototype.destroy = destroyImpl.destroy;
              Writable.prototype._undestroy = destroyImpl.undestroy;
              Writable.prototype._destroy = function(err, cb) {
                cb(err);
              };
            }).call(this);
          }).call(this, require2("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "../errors": 66, "./_stream_duplex": 67, "./internal/streams/destroy": 74, "./internal/streams/state": 78, "./internal/streams/stream": 79, "_process": 63, "buffer": 32, "inherits": 46, "util-deprecate": 81 }], 72: [function(require2, module3, exports3) {
          (function(process) {
            (function() {
              "use strict";
              var _Object$setPrototypeO;
              function _defineProperty(obj, key, value) {
                if (key in obj) {
                  Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
                } else {
                  obj[key] = value;
                }
                return obj;
              }
              var finished = require2("./end-of-stream");
              var kLastResolve = Symbol("lastResolve");
              var kLastReject = Symbol("lastReject");
              var kError = Symbol("error");
              var kEnded = Symbol("ended");
              var kLastPromise = Symbol("lastPromise");
              var kHandlePromise = Symbol("handlePromise");
              var kStream = Symbol("stream");
              function createIterResult(value, done) {
                return {
                  value,
                  done
                };
              }
              function readAndResolve(iter) {
                var resolve = iter[kLastResolve];
                if (resolve !== null) {
                  var data = iter[kStream].read();
                  if (data !== null) {
                    iter[kLastPromise] = null;
                    iter[kLastResolve] = null;
                    iter[kLastReject] = null;
                    resolve(createIterResult(data, false));
                  }
                }
              }
              function onReadable(iter) {
                process.nextTick(readAndResolve, iter);
              }
              function wrapForNext(lastPromise, iter) {
                return function(resolve, reject) {
                  lastPromise.then(function() {
                    if (iter[kEnded]) {
                      resolve(createIterResult(void 0, true));
                      return;
                    }
                    iter[kHandlePromise](resolve, reject);
                  }, reject);
                };
              }
              var AsyncIteratorPrototype = Object.getPrototypeOf(function() {
              });
              var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
                get stream() {
                  return this[kStream];
                },
                next: function next() {
                  var _this = this;
                  var error = this[kError];
                  if (error !== null) {
                    return Promise.reject(error);
                  }
                  if (this[kEnded]) {
                    return Promise.resolve(createIterResult(void 0, true));
                  }
                  if (this[kStream].destroyed) {
                    return new Promise(function(resolve, reject) {
                      process.nextTick(function() {
                        if (_this[kError]) {
                          reject(_this[kError]);
                        } else {
                          resolve(createIterResult(void 0, true));
                        }
                      });
                    });
                  }
                  var lastPromise = this[kLastPromise];
                  var promise;
                  if (lastPromise) {
                    promise = new Promise(wrapForNext(lastPromise, this));
                  } else {
                    var data = this[kStream].read();
                    if (data !== null) {
                      return Promise.resolve(createIterResult(data, false));
                    }
                    promise = new Promise(this[kHandlePromise]);
                  }
                  this[kLastPromise] = promise;
                  return promise;
                }
              }, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function() {
                return this;
              }), _defineProperty(_Object$setPrototypeO, "return", function _return() {
                var _this2 = this;
                return new Promise(function(resolve, reject) {
                  _this2[kStream].destroy(null, function(err) {
                    if (err) {
                      reject(err);
                      return;
                    }
                    resolve(createIterResult(void 0, true));
                  });
                });
              }), _Object$setPrototypeO), AsyncIteratorPrototype);
              var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator2(stream) {
                var _Object$create;
                var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
                  value: stream,
                  writable: true
                }), _defineProperty(_Object$create, kLastResolve, {
                  value: null,
                  writable: true
                }), _defineProperty(_Object$create, kLastReject, {
                  value: null,
                  writable: true
                }), _defineProperty(_Object$create, kError, {
                  value: null,
                  writable: true
                }), _defineProperty(_Object$create, kEnded, {
                  value: stream._readableState.endEmitted,
                  writable: true
                }), _defineProperty(_Object$create, kHandlePromise, {
                  value: function value(resolve, reject) {
                    var data = iterator[kStream].read();
                    if (data) {
                      iterator[kLastPromise] = null;
                      iterator[kLastResolve] = null;
                      iterator[kLastReject] = null;
                      resolve(createIterResult(data, false));
                    } else {
                      iterator[kLastResolve] = resolve;
                      iterator[kLastReject] = reject;
                    }
                  },
                  writable: true
                }), _Object$create));
                iterator[kLastPromise] = null;
                finished(stream, function(err) {
                  if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
                    var reject = iterator[kLastReject];
                    if (reject !== null) {
                      iterator[kLastPromise] = null;
                      iterator[kLastResolve] = null;
                      iterator[kLastReject] = null;
                      reject(err);
                    }
                    iterator[kError] = err;
                    return;
                  }
                  var resolve = iterator[kLastResolve];
                  if (resolve !== null) {
                    iterator[kLastPromise] = null;
                    iterator[kLastResolve] = null;
                    iterator[kLastReject] = null;
                    resolve(createIterResult(void 0, true));
                  }
                  iterator[kEnded] = true;
                });
                stream.on("readable", onReadable.bind(null, iterator));
                return iterator;
              };
              module3.exports = createReadableStreamAsyncIterator;
            }).call(this);
          }).call(this, require2("_process"));
        }, { "./end-of-stream": 75, "_process": 63 }], 73: [function(require2, module3, exports3) {
          "use strict";
          function ownKeys(object, enumerableOnly) {
            var keys = Object.keys(object);
            if (Object.getOwnPropertySymbols) {
              var symbols = Object.getOwnPropertySymbols(object);
              if (enumerableOnly) symbols = symbols.filter(function(sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
              keys.push.apply(keys, symbols);
            }
            return keys;
          }
          function _objectSpread(target) {
            for (var i = 1; i < arguments.length; i++) {
              var source = arguments[i] != null ? arguments[i] : {};
              if (i % 2) {
                ownKeys(Object(source), true).forEach(function(key) {
                  _defineProperty(target, key, source[key]);
                });
              } else if (Object.getOwnPropertyDescriptors) {
                Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
              } else {
                ownKeys(Object(source)).forEach(function(key) {
                  Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
                });
              }
            }
            return target;
          }
          function _defineProperty(obj, key, value) {
            if (key in obj) {
              Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
            } else {
              obj[key] = value;
            }
            return obj;
          }
          function _classCallCheck(instance, Constructor) {
            if (!(instance instanceof Constructor)) {
              throw new TypeError("Cannot call a class as a function");
            }
          }
          function _defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
              var descriptor = props[i];
              descriptor.enumerable = descriptor.enumerable || false;
              descriptor.configurable = true;
              if ("value" in descriptor) descriptor.writable = true;
              Object.defineProperty(target, descriptor.key, descriptor);
            }
          }
          function _createClass(Constructor, protoProps, staticProps) {
            if (protoProps) _defineProperties(Constructor.prototype, protoProps);
            if (staticProps) _defineProperties(Constructor, staticProps);
            return Constructor;
          }
          var _require = require2("buffer"), Buffer2 = _require.Buffer;
          var _require2 = require2("util"), inspect = _require2.inspect;
          var custom = inspect && inspect.custom || "inspect";
          function copyBuffer(src, target, offset) {
            Buffer2.prototype.copy.call(src, target, offset);
          }
          module3.exports = /* @__PURE__ */ function() {
            function BufferList() {
              _classCallCheck(this, BufferList);
              this.head = null;
              this.tail = null;
              this.length = 0;
            }
            _createClass(BufferList, [{
              key: "push",
              value: function push(v) {
                var entry = {
                  data: v,
                  next: null
                };
                if (this.length > 0) this.tail.next = entry;
                else this.head = entry;
                this.tail = entry;
                ++this.length;
              }
            }, {
              key: "unshift",
              value: function unshift(v) {
                var entry = {
                  data: v,
                  next: this.head
                };
                if (this.length === 0) this.tail = entry;
                this.head = entry;
                ++this.length;
              }
            }, {
              key: "shift",
              value: function shift() {
                if (this.length === 0) return;
                var ret = this.head.data;
                if (this.length === 1) this.head = this.tail = null;
                else this.head = this.head.next;
                --this.length;
                return ret;
              }
            }, {
              key: "clear",
              value: function clear() {
                this.head = this.tail = null;
                this.length = 0;
              }
            }, {
              key: "join",
              value: function join(s) {
                if (this.length === 0) return "";
                var p = this.head;
                var ret = "" + p.data;
                while (p = p.next) {
                  ret += s + p.data;
                }
                return ret;
              }
            }, {
              key: "concat",
              value: function concat(n) {
                if (this.length === 0) return Buffer2.alloc(0);
                var ret = Buffer2.allocUnsafe(n >>> 0);
                var p = this.head;
                var i = 0;
                while (p) {
                  copyBuffer(p.data, ret, i);
                  i += p.data.length;
                  p = p.next;
                }
                return ret;
              }
              // Consumes a specified amount of bytes or characters from the buffered data.
            }, {
              key: "consume",
              value: function consume(n, hasStrings) {
                var ret;
                if (n < this.head.data.length) {
                  ret = this.head.data.slice(0, n);
                  this.head.data = this.head.data.slice(n);
                } else if (n === this.head.data.length) {
                  ret = this.shift();
                } else {
                  ret = hasStrings ? this._getString(n) : this._getBuffer(n);
                }
                return ret;
              }
            }, {
              key: "first",
              value: function first() {
                return this.head.data;
              }
              // Consumes a specified amount of characters from the buffered data.
            }, {
              key: "_getString",
              value: function _getString(n) {
                var p = this.head;
                var c = 1;
                var ret = p.data;
                n -= ret.length;
                while (p = p.next) {
                  var str = p.data;
                  var nb = n > str.length ? str.length : n;
                  if (nb === str.length) ret += str;
                  else ret += str.slice(0, n);
                  n -= nb;
                  if (n === 0) {
                    if (nb === str.length) {
                      ++c;
                      if (p.next) this.head = p.next;
                      else this.head = this.tail = null;
                    } else {
                      this.head = p;
                      p.data = str.slice(nb);
                    }
                    break;
                  }
                  ++c;
                }
                this.length -= c;
                return ret;
              }
              // Consumes a specified amount of bytes from the buffered data.
            }, {
              key: "_getBuffer",
              value: function _getBuffer(n) {
                var ret = Buffer2.allocUnsafe(n);
                var p = this.head;
                var c = 1;
                p.data.copy(ret);
                n -= p.data.length;
                while (p = p.next) {
                  var buf = p.data;
                  var nb = n > buf.length ? buf.length : n;
                  buf.copy(ret, ret.length - n, 0, nb);
                  n -= nb;
                  if (n === 0) {
                    if (nb === buf.length) {
                      ++c;
                      if (p.next) this.head = p.next;
                      else this.head = this.tail = null;
                    } else {
                      this.head = p;
                      p.data = buf.slice(nb);
                    }
                    break;
                  }
                  ++c;
                }
                this.length -= c;
                return ret;
              }
              // Make sure the linked list only shows the minimal necessary information.
            }, {
              key: custom,
              value: function value(_, options) {
                return inspect(this, _objectSpread({}, options, {
                  // Only inspect one level.
                  depth: 0,
                  // It should not recurse.
                  customInspect: false
                }));
              }
            }]);
            return BufferList;
          }();
        }, { "buffer": 32, "util": 29 }], 74: [function(require2, module3, exports3) {
          (function(process) {
            (function() {
              "use strict";
              function destroy(err, cb) {
                var _this = this;
                var readableDestroyed = this._readableState && this._readableState.destroyed;
                var writableDestroyed = this._writableState && this._writableState.destroyed;
                if (readableDestroyed || writableDestroyed) {
                  if (cb) {
                    cb(err);
                  } else if (err) {
                    if (!this._writableState) {
                      process.nextTick(emitErrorNT, this, err);
                    } else if (!this._writableState.errorEmitted) {
                      this._writableState.errorEmitted = true;
                      process.nextTick(emitErrorNT, this, err);
                    }
                  }
                  return this;
                }
                if (this._readableState) {
                  this._readableState.destroyed = true;
                }
                if (this._writableState) {
                  this._writableState.destroyed = true;
                }
                this._destroy(err || null, function(err2) {
                  if (!cb && err2) {
                    if (!_this._writableState) {
                      process.nextTick(emitErrorAndCloseNT, _this, err2);
                    } else if (!_this._writableState.errorEmitted) {
                      _this._writableState.errorEmitted = true;
                      process.nextTick(emitErrorAndCloseNT, _this, err2);
                    } else {
                      process.nextTick(emitCloseNT, _this);
                    }
                  } else if (cb) {
                    process.nextTick(emitCloseNT, _this);
                    cb(err2);
                  } else {
                    process.nextTick(emitCloseNT, _this);
                  }
                });
                return this;
              }
              function emitErrorAndCloseNT(self2, err) {
                emitErrorNT(self2, err);
                emitCloseNT(self2);
              }
              function emitCloseNT(self2) {
                if (self2._writableState && !self2._writableState.emitClose) return;
                if (self2._readableState && !self2._readableState.emitClose) return;
                self2.emit("close");
              }
              function undestroy() {
                if (this._readableState) {
                  this._readableState.destroyed = false;
                  this._readableState.reading = false;
                  this._readableState.ended = false;
                  this._readableState.endEmitted = false;
                }
                if (this._writableState) {
                  this._writableState.destroyed = false;
                  this._writableState.ended = false;
                  this._writableState.ending = false;
                  this._writableState.finalCalled = false;
                  this._writableState.prefinished = false;
                  this._writableState.finished = false;
                  this._writableState.errorEmitted = false;
                }
              }
              function emitErrorNT(self2, err) {
                self2.emit("error", err);
              }
              function errorOrDestroy(stream, err) {
                var rState = stream._readableState;
                var wState = stream._writableState;
                if (rState && rState.autoDestroy || wState && wState.autoDestroy) stream.destroy(err);
                else stream.emit("error", err);
              }
              module3.exports = {
                destroy,
                undestroy,
                errorOrDestroy
              };
            }).call(this);
          }).call(this, require2("_process"));
        }, { "_process": 63 }], 75: [function(require2, module3, exports3) {
          "use strict";
          var ERR_STREAM_PREMATURE_CLOSE = require2("../../../errors").codes.ERR_STREAM_PREMATURE_CLOSE;
          function once(callback) {
            var called = false;
            return function() {
              if (called) return;
              called = true;
              for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
                args[_key] = arguments[_key];
              }
              callback.apply(this, args);
            };
          }
          function noop() {
          }
          function isRequest(stream) {
            return stream.setHeader && typeof stream.abort === "function";
          }
          function eos(stream, opts, callback) {
            if (typeof opts === "function") return eos(stream, null, opts);
            if (!opts) opts = {};
            callback = once(callback || noop);
            var readable = opts.readable || opts.readable !== false && stream.readable;
            var writable = opts.writable || opts.writable !== false && stream.writable;
            var onlegacyfinish = function onlegacyfinish2() {
              if (!stream.writable) onfinish();
            };
            var writableEnded = stream._writableState && stream._writableState.finished;
            var onfinish = function onfinish2() {
              writable = false;
              writableEnded = true;
              if (!readable) callback.call(stream);
            };
            var readableEnded = stream._readableState && stream._readableState.endEmitted;
            var onend = function onend2() {
              readable = false;
              readableEnded = true;
              if (!writable) callback.call(stream);
            };
            var onerror = function onerror2(err) {
              callback.call(stream, err);
            };
            var onclose = function onclose2() {
              var err;
              if (readable && !readableEnded) {
                if (!stream._readableState || !stream._readableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
                return callback.call(stream, err);
              }
              if (writable && !writableEnded) {
                if (!stream._writableState || !stream._writableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
                return callback.call(stream, err);
              }
            };
            var onrequest = function onrequest2() {
              stream.req.on("finish", onfinish);
            };
            if (isRequest(stream)) {
              stream.on("complete", onfinish);
              stream.on("abort", onclose);
              if (stream.req) onrequest();
              else stream.on("request", onrequest);
            } else if (writable && !stream._writableState) {
              stream.on("end", onlegacyfinish);
              stream.on("close", onlegacyfinish);
            }
            stream.on("end", onend);
            stream.on("finish", onfinish);
            if (opts.error !== false) stream.on("error", onerror);
            stream.on("close", onclose);
            return function() {
              stream.removeListener("complete", onfinish);
              stream.removeListener("abort", onclose);
              stream.removeListener("request", onrequest);
              if (stream.req) stream.req.removeListener("finish", onfinish);
              stream.removeListener("end", onlegacyfinish);
              stream.removeListener("close", onlegacyfinish);
              stream.removeListener("finish", onfinish);
              stream.removeListener("end", onend);
              stream.removeListener("error", onerror);
              stream.removeListener("close", onclose);
            };
          }
          module3.exports = eos;
        }, { "../../../errors": 66 }], 76: [function(require2, module3, exports3) {
          module3.exports = function() {
            throw new Error("Readable.from is not available in the browser");
          };
        }, {}], 77: [function(require2, module3, exports3) {
          "use strict";
          var eos;
          function once(callback) {
            var called = false;
            return function() {
              if (called) return;
              called = true;
              callback.apply(void 0, arguments);
            };
          }
          var _require$codes = require2("../../../errors").codes, ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS, ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
          function noop(err) {
            if (err) throw err;
          }
          function isRequest(stream) {
            return stream.setHeader && typeof stream.abort === "function";
          }
          function destroyer(stream, reading, writing, callback) {
            callback = once(callback);
            var closed = false;
            stream.on("close", function() {
              closed = true;
            });
            if (eos === void 0) eos = require2("./end-of-stream");
            eos(stream, {
              readable: reading,
              writable: writing
            }, function(err) {
              if (err) return callback(err);
              closed = true;
              callback();
            });
            var destroyed = false;
            return function(err) {
              if (closed) return;
              if (destroyed) return;
              destroyed = true;
              if (isRequest(stream)) return stream.abort();
              if (typeof stream.destroy === "function") return stream.destroy();
              callback(err || new ERR_STREAM_DESTROYED("pipe"));
            };
          }
          function call(fn) {
            fn();
          }
          function pipe(from, to) {
            return from.pipe(to);
          }
          function popCallback(streams) {
            if (!streams.length) return noop;
            if (typeof streams[streams.length - 1] !== "function") return noop;
            return streams.pop();
          }
          function pipeline() {
            for (var _len = arguments.length, streams = new Array(_len), _key = 0; _key < _len; _key++) {
              streams[_key] = arguments[_key];
            }
            var callback = popCallback(streams);
            if (Array.isArray(streams[0])) streams = streams[0];
            if (streams.length < 2) {
              throw new ERR_MISSING_ARGS("streams");
            }
            var error;
            var destroys = streams.map(function(stream, i) {
              var reading = i < streams.length - 1;
              var writing = i > 0;
              return destroyer(stream, reading, writing, function(err) {
                if (!error) error = err;
                if (err) destroys.forEach(call);
                if (reading) return;
                destroys.forEach(call);
                callback(error);
              });
            });
            return streams.reduce(pipe);
          }
          module3.exports = pipeline;
        }, { "../../../errors": 66, "./end-of-stream": 75 }], 78: [function(require2, module3, exports3) {
          "use strict";
          var ERR_INVALID_OPT_VALUE = require2("../../../errors").codes.ERR_INVALID_OPT_VALUE;
          function highWaterMarkFrom(options, isDuplex, duplexKey) {
            return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
          }
          function getHighWaterMark(state, options, duplexKey, isDuplex) {
            var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
            if (hwm != null) {
              if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
                var name = isDuplex ? duplexKey : "highWaterMark";
                throw new ERR_INVALID_OPT_VALUE(name, hwm);
              }
              return Math.floor(hwm);
            }
            return state.objectMode ? 16 : 16 * 1024;
          }
          module3.exports = {
            getHighWaterMark
          };
        }, { "../../../errors": 66 }], 79: [function(require2, module3, exports3) {
          module3.exports = require2("events").EventEmitter;
        }, { "events": 35 }], 80: [function(require2, module3, exports3) {
          "use strict";
          var Buffer2 = require2("safe-buffer").Buffer;
          var isEncoding = Buffer2.isEncoding || function(encoding) {
            encoding = "" + encoding;
            switch (encoding && encoding.toLowerCase()) {
              case "hex":
              case "utf8":
              case "utf-8":
              case "ascii":
              case "binary":
              case "base64":
              case "ucs2":
              case "ucs-2":
              case "utf16le":
              case "utf-16le":
              case "raw":
                return true;
              default:
                return false;
            }
          };
          function _normalizeEncoding(enc) {
            if (!enc) return "utf8";
            var retried;
            while (true) {
              switch (enc) {
                case "utf8":
                case "utf-8":
                  return "utf8";
                case "ucs2":
                case "ucs-2":
                case "utf16le":
                case "utf-16le":
                  return "utf16le";
                case "latin1":
                case "binary":
                  return "latin1";
                case "base64":
                case "ascii":
                case "hex":
                  return enc;
                default:
                  if (retried) return;
                  enc = ("" + enc).toLowerCase();
                  retried = true;
              }
            }
          }
          ;
          function normalizeEncoding(enc) {
            var nenc = _normalizeEncoding(enc);
            if (typeof nenc !== "string" && (Buffer2.isEncoding === isEncoding || !isEncoding(enc))) throw new Error("Unknown encoding: " + enc);
            return nenc || enc;
          }
          exports3.StringDecoder = StringDecoder;
          function StringDecoder(encoding) {
            this.encoding = normalizeEncoding(encoding);
            var nb;
            switch (this.encoding) {
              case "utf16le":
                this.text = utf16Text;
                this.end = utf16End;
                nb = 4;
                break;
              case "utf8":
                this.fillLast = utf8FillLast;
                nb = 4;
                break;
              case "base64":
                this.text = base64Text;
                this.end = base64End;
                nb = 3;
                break;
              default:
                this.write = simpleWrite;
                this.end = simpleEnd;
                return;
            }
            this.lastNeed = 0;
            this.lastTotal = 0;
            this.lastChar = Buffer2.allocUnsafe(nb);
          }
          StringDecoder.prototype.write = function(buf) {
            if (buf.length === 0) return "";
            var r;
            var i;
            if (this.lastNeed) {
              r = this.fillLast(buf);
              if (r === void 0) return "";
              i = this.lastNeed;
              this.lastNeed = 0;
            } else {
              i = 0;
            }
            if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
            return r || "";
          };
          StringDecoder.prototype.end = utf8End;
          StringDecoder.prototype.text = utf8Text;
          StringDecoder.prototype.fillLast = function(buf) {
            if (this.lastNeed <= buf.length) {
              buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
              return this.lastChar.toString(this.encoding, 0, this.lastTotal);
            }
            buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
            this.lastNeed -= buf.length;
          };
          function utf8CheckByte(byte) {
            if (byte <= 127) return 0;
            else if (byte >> 5 === 6) return 2;
            else if (byte >> 4 === 14) return 3;
            else if (byte >> 3 === 30) return 4;
            return byte >> 6 === 2 ? -1 : -2;
          }
          function utf8CheckIncomplete(self2, buf, i) {
            var j = buf.length - 1;
            if (j < i) return 0;
            var nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
              if (nb > 0) self2.lastNeed = nb - 1;
              return nb;
            }
            if (--j < i || nb === -2) return 0;
            nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
              if (nb > 0) self2.lastNeed = nb - 2;
              return nb;
            }
            if (--j < i || nb === -2) return 0;
            nb = utf8CheckByte(buf[j]);
            if (nb >= 0) {
              if (nb > 0) {
                if (nb === 2) nb = 0;
                else self2.lastNeed = nb - 3;
              }
              return nb;
            }
            return 0;
          }
          function utf8CheckExtraBytes(self2, buf, p) {
            if ((buf[0] & 192) !== 128) {
              self2.lastNeed = 0;
              return "\uFFFD";
            }
            if (self2.lastNeed > 1 && buf.length > 1) {
              if ((buf[1] & 192) !== 128) {
                self2.lastNeed = 1;
                return "\uFFFD";
              }
              if (self2.lastNeed > 2 && buf.length > 2) {
                if ((buf[2] & 192) !== 128) {
                  self2.lastNeed = 2;
                  return "\uFFFD";
                }
              }
            }
          }
          function utf8FillLast(buf) {
            var p = this.lastTotal - this.lastNeed;
            var r = utf8CheckExtraBytes(this, buf, p);
            if (r !== void 0) return r;
            if (this.lastNeed <= buf.length) {
              buf.copy(this.lastChar, p, 0, this.lastNeed);
              return this.lastChar.toString(this.encoding, 0, this.lastTotal);
            }
            buf.copy(this.lastChar, p, 0, buf.length);
            this.lastNeed -= buf.length;
          }
          function utf8Text(buf, i) {
            var total = utf8CheckIncomplete(this, buf, i);
            if (!this.lastNeed) return buf.toString("utf8", i);
            this.lastTotal = total;
            var end = buf.length - (total - this.lastNeed);
            buf.copy(this.lastChar, 0, end);
            return buf.toString("utf8", i, end);
          }
          function utf8End(buf) {
            var r = buf && buf.length ? this.write(buf) : "";
            if (this.lastNeed) return r + "\uFFFD";
            return r;
          }
          function utf16Text(buf, i) {
            if ((buf.length - i) % 2 === 0) {
              var r = buf.toString("utf16le", i);
              if (r) {
                var c = r.charCodeAt(r.length - 1);
                if (c >= 55296 && c <= 56319) {
                  this.lastNeed = 2;
                  this.lastTotal = 4;
                  this.lastChar[0] = buf[buf.length - 2];
                  this.lastChar[1] = buf[buf.length - 1];
                  return r.slice(0, -1);
                }
              }
              return r;
            }
            this.lastNeed = 1;
            this.lastTotal = 2;
            this.lastChar[0] = buf[buf.length - 1];
            return buf.toString("utf16le", i, buf.length - 1);
          }
          function utf16End(buf) {
            var r = buf && buf.length ? this.write(buf) : "";
            if (this.lastNeed) {
              var end = this.lastTotal - this.lastNeed;
              return r + this.lastChar.toString("utf16le", 0, end);
            }
            return r;
          }
          function base64Text(buf, i) {
            var n = (buf.length - i) % 3;
            if (n === 0) return buf.toString("base64", i);
            this.lastNeed = 3 - n;
            this.lastTotal = 3;
            if (n === 1) {
              this.lastChar[0] = buf[buf.length - 1];
            } else {
              this.lastChar[0] = buf[buf.length - 2];
              this.lastChar[1] = buf[buf.length - 1];
            }
            return buf.toString("base64", i, buf.length - n);
          }
          function base64End(buf) {
            var r = buf && buf.length ? this.write(buf) : "";
            if (this.lastNeed) return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
            return r;
          }
          function simpleWrite(buf) {
            return buf.toString(this.encoding);
          }
          function simpleEnd(buf) {
            return buf && buf.length ? this.write(buf) : "";
          }
        }, { "safe-buffer": 64 }], 81: [function(require2, module3, exports3) {
          (function(global2) {
            (function() {
              module3.exports = deprecate;
              function deprecate(fn, msg) {
                if (config("noDeprecation")) {
                  return fn;
                }
                var warned = false;
                function deprecated() {
                  if (!warned) {
                    if (config("throwDeprecation")) {
                      throw new Error(msg);
                    } else if (config("traceDeprecation")) {
                      console.trace(msg);
                    } else {
                      console.warn(msg);
                    }
                    warned = true;
                  }
                  return fn.apply(this, arguments);
                }
                return deprecated;
              }
              function config(name) {
                try {
                  if (!global2.localStorage) return false;
                } catch (_) {
                  return false;
                }
                var val2 = global2.localStorage[name];
                if (null == val2) return false;
                return String(val2).toLowerCase() === "true";
              }
            }).call(this);
          }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {}], 82: [function(require2, module3, exports3) {
          arguments[4][25][0].apply(exports3, arguments);
        }, { "dup": 25 }], 83: [function(require2, module3, exports3) {
          "use strict";
          var isArgumentsObject = require2("is-arguments");
          var isGeneratorFunction = require2("is-generator-function");
          var whichTypedArray = require2("which-typed-array");
          var isTypedArray = require2("is-typed-array");
          function uncurryThis(f) {
            return f.call.bind(f);
          }
          var BigIntSupported = typeof BigInt !== "undefined";
          var SymbolSupported = typeof Symbol !== "undefined";
          var ObjectToString = uncurryThis(Object.prototype.toString);
          var numberValue = uncurryThis(Number.prototype.valueOf);
          var stringValue = uncurryThis(String.prototype.valueOf);
          var booleanValue = uncurryThis(Boolean.prototype.valueOf);
          if (BigIntSupported) {
            var bigIntValue = uncurryThis(BigInt.prototype.valueOf);
          }
          if (SymbolSupported) {
            var symbolValue = uncurryThis(Symbol.prototype.valueOf);
          }
          function checkBoxedPrimitive(value, prototypeValueOf) {
            if (typeof value !== "object") {
              return false;
            }
            try {
              prototypeValueOf(value);
              return true;
            } catch (e) {
              return false;
            }
          }
          exports3.isArgumentsObject = isArgumentsObject;
          exports3.isGeneratorFunction = isGeneratorFunction;
          exports3.isTypedArray = isTypedArray;
          function isPromise(input) {
            return typeof Promise !== "undefined" && input instanceof Promise || input !== null && typeof input === "object" && typeof input.then === "function" && typeof input.catch === "function";
          }
          exports3.isPromise = isPromise;
          function isArrayBufferView(value) {
            if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView) {
              return ArrayBuffer.isView(value);
            }
            return isTypedArray(value) || isDataView(value);
          }
          exports3.isArrayBufferView = isArrayBufferView;
          function isUint8Array(value) {
            return whichTypedArray(value) === "Uint8Array";
          }
          exports3.isUint8Array = isUint8Array;
          function isUint8ClampedArray(value) {
            return whichTypedArray(value) === "Uint8ClampedArray";
          }
          exports3.isUint8ClampedArray = isUint8ClampedArray;
          function isUint16Array(value) {
            return whichTypedArray(value) === "Uint16Array";
          }
          exports3.isUint16Array = isUint16Array;
          function isUint32Array(value) {
            return whichTypedArray(value) === "Uint32Array";
          }
          exports3.isUint32Array = isUint32Array;
          function isInt8Array(value) {
            return whichTypedArray(value) === "Int8Array";
          }
          exports3.isInt8Array = isInt8Array;
          function isInt16Array(value) {
            return whichTypedArray(value) === "Int16Array";
          }
          exports3.isInt16Array = isInt16Array;
          function isInt32Array(value) {
            return whichTypedArray(value) === "Int32Array";
          }
          exports3.isInt32Array = isInt32Array;
          function isFloat32Array(value) {
            return whichTypedArray(value) === "Float32Array";
          }
          exports3.isFloat32Array = isFloat32Array;
          function isFloat64Array(value) {
            return whichTypedArray(value) === "Float64Array";
          }
          exports3.isFloat64Array = isFloat64Array;
          function isBigInt64Array(value) {
            return whichTypedArray(value) === "BigInt64Array";
          }
          exports3.isBigInt64Array = isBigInt64Array;
          function isBigUint64Array(value) {
            return whichTypedArray(value) === "BigUint64Array";
          }
          exports3.isBigUint64Array = isBigUint64Array;
          function isMapToString(value) {
            return ObjectToString(value) === "[object Map]";
          }
          isMapToString.working = typeof Map !== "undefined" && isMapToString(/* @__PURE__ */ new Map());
          function isMap(value) {
            if (typeof Map === "undefined") {
              return false;
            }
            return isMapToString.working ? isMapToString(value) : value instanceof Map;
          }
          exports3.isMap = isMap;
          function isSetToString(value) {
            return ObjectToString(value) === "[object Set]";
          }
          isSetToString.working = typeof Set !== "undefined" && isSetToString(/* @__PURE__ */ new Set());
          function isSet(value) {
            if (typeof Set === "undefined") {
              return false;
            }
            return isSetToString.working ? isSetToString(value) : value instanceof Set;
          }
          exports3.isSet = isSet;
          function isWeakMapToString(value) {
            return ObjectToString(value) === "[object WeakMap]";
          }
          isWeakMapToString.working = typeof WeakMap !== "undefined" && isWeakMapToString(/* @__PURE__ */ new WeakMap());
          function isWeakMap(value) {
            if (typeof WeakMap === "undefined") {
              return false;
            }
            return isWeakMapToString.working ? isWeakMapToString(value) : value instanceof WeakMap;
          }
          exports3.isWeakMap = isWeakMap;
          function isWeakSetToString(value) {
            return ObjectToString(value) === "[object WeakSet]";
          }
          isWeakSetToString.working = typeof WeakSet !== "undefined" && isWeakSetToString(/* @__PURE__ */ new WeakSet());
          function isWeakSet(value) {
            return isWeakSetToString(value);
          }
          exports3.isWeakSet = isWeakSet;
          function isArrayBufferToString(value) {
            return ObjectToString(value) === "[object ArrayBuffer]";
          }
          isArrayBufferToString.working = typeof ArrayBuffer !== "undefined" && isArrayBufferToString(new ArrayBuffer());
          function isArrayBuffer(value) {
            if (typeof ArrayBuffer === "undefined") {
              return false;
            }
            return isArrayBufferToString.working ? isArrayBufferToString(value) : value instanceof ArrayBuffer;
          }
          exports3.isArrayBuffer = isArrayBuffer;
          function isDataViewToString(value) {
            return ObjectToString(value) === "[object DataView]";
          }
          isDataViewToString.working = typeof ArrayBuffer !== "undefined" && typeof DataView !== "undefined" && isDataViewToString(new DataView(new ArrayBuffer(1), 0, 1));
          function isDataView(value) {
            if (typeof DataView === "undefined") {
              return false;
            }
            return isDataViewToString.working ? isDataViewToString(value) : value instanceof DataView;
          }
          exports3.isDataView = isDataView;
          var SharedArrayBufferCopy = typeof SharedArrayBuffer !== "undefined" ? SharedArrayBuffer : void 0;
          function isSharedArrayBufferToString(value) {
            return ObjectToString(value) === "[object SharedArrayBuffer]";
          }
          function isSharedArrayBuffer(value) {
            if (typeof SharedArrayBufferCopy === "undefined") {
              return false;
            }
            if (typeof isSharedArrayBufferToString.working === "undefined") {
              isSharedArrayBufferToString.working = isSharedArrayBufferToString(new SharedArrayBufferCopy());
            }
            return isSharedArrayBufferToString.working ? isSharedArrayBufferToString(value) : value instanceof SharedArrayBufferCopy;
          }
          exports3.isSharedArrayBuffer = isSharedArrayBuffer;
          function isAsyncFunction(value) {
            return ObjectToString(value) === "[object AsyncFunction]";
          }
          exports3.isAsyncFunction = isAsyncFunction;
          function isMapIterator(value) {
            return ObjectToString(value) === "[object Map Iterator]";
          }
          exports3.isMapIterator = isMapIterator;
          function isSetIterator(value) {
            return ObjectToString(value) === "[object Set Iterator]";
          }
          exports3.isSetIterator = isSetIterator;
          function isGeneratorObject(value) {
            return ObjectToString(value) === "[object Generator]";
          }
          exports3.isGeneratorObject = isGeneratorObject;
          function isWebAssemblyCompiledModule(value) {
            return ObjectToString(value) === "[object WebAssembly.Module]";
          }
          exports3.isWebAssemblyCompiledModule = isWebAssemblyCompiledModule;
          function isNumberObject(value) {
            return checkBoxedPrimitive(value, numberValue);
          }
          exports3.isNumberObject = isNumberObject;
          function isStringObject(value) {
            return checkBoxedPrimitive(value, stringValue);
          }
          exports3.isStringObject = isStringObject;
          function isBooleanObject(value) {
            return checkBoxedPrimitive(value, booleanValue);
          }
          exports3.isBooleanObject = isBooleanObject;
          function isBigIntObject(value) {
            return BigIntSupported && checkBoxedPrimitive(value, bigIntValue);
          }
          exports3.isBigIntObject = isBigIntObject;
          function isSymbolObject(value) {
            return SymbolSupported && checkBoxedPrimitive(value, symbolValue);
          }
          exports3.isSymbolObject = isSymbolObject;
          function isBoxedPrimitive(value) {
            return isNumberObject(value) || isStringObject(value) || isBooleanObject(value) || isBigIntObject(value) || isSymbolObject(value);
          }
          exports3.isBoxedPrimitive = isBoxedPrimitive;
          function isAnyArrayBuffer(value) {
            return typeof Uint8Array !== "undefined" && (isArrayBuffer(value) || isSharedArrayBuffer(value));
          }
          exports3.isAnyArrayBuffer = isAnyArrayBuffer;
          ["isProxy", "isExternal", "isModuleNamespaceObject"].forEach(function(method) {
            Object.defineProperty(exports3, method, {
              enumerable: false,
              value: function() {
                throw new Error(method + " is not supported in userland");
              }
            });
          });
        }, { "is-arguments": 47, "is-generator-function": 49, "is-typed-array": 50, "which-typed-array": 85 }], 84: [function(require2, module3, exports3) {
          (function(process) {
            (function() {
              var getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors || function getOwnPropertyDescriptors2(obj) {
                var keys = Object.keys(obj);
                var descriptors = {};
                for (var i = 0; i < keys.length; i++) {
                  descriptors[keys[i]] = Object.getOwnPropertyDescriptor(obj, keys[i]);
                }
                return descriptors;
              };
              var formatRegExp = /%[sdj%]/g;
              exports3.format = function(f) {
                if (!isString(f)) {
                  var objects = [];
                  for (var i = 0; i < arguments.length; i++) {
                    objects.push(inspect(arguments[i]));
                  }
                  return objects.join(" ");
                }
                var i = 1;
                var args = arguments;
                var len = args.length;
                var str = String(f).replace(formatRegExp, function(x2) {
                  if (x2 === "%%") return "%";
                  if (i >= len) return x2;
                  switch (x2) {
                    case "%s":
                      return String(args[i++]);
                    case "%d":
                      return Number(args[i++]);
                    case "%j":
                      try {
                        return JSON.stringify(args[i++]);
                      } catch (_) {
                        return "[Circular]";
                      }
                    default:
                      return x2;
                  }
                });
                for (var x = args[i]; i < len; x = args[++i]) {
                  if (isNull(x) || !isObject(x)) {
                    str += " " + x;
                  } else {
                    str += " " + inspect(x);
                  }
                }
                return str;
              };
              exports3.deprecate = function(fn, msg) {
                if (typeof process !== "undefined" && process.noDeprecation === true) {
                  return fn;
                }
                if (typeof process === "undefined") {
                  return function() {
                    return exports3.deprecate(fn, msg).apply(this, arguments);
                  };
                }
                var warned = false;
                function deprecated() {
                  if (!warned) {
                    if (process.throwDeprecation) {
                      throw new Error(msg);
                    } else if (process.traceDeprecation) {
                      console.trace(msg);
                    } else {
                      console.error(msg);
                    }
                    warned = true;
                  }
                  return fn.apply(this, arguments);
                }
                return deprecated;
              };
              var debugs = {};
              var debugEnvRegex = /^$/;
              if (process.env.NODE_DEBUG) {
                var debugEnv = process.env.NODE_DEBUG;
                debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*").replace(/,/g, "$|^").toUpperCase();
                debugEnvRegex = new RegExp("^" + debugEnv + "$", "i");
              }
              exports3.debuglog = function(set) {
                set = set.toUpperCase();
                if (!debugs[set]) {
                  if (debugEnvRegex.test(set)) {
                    var pid = process.pid;
                    debugs[set] = function() {
                      var msg = exports3.format.apply(exports3, arguments);
                      console.error("%s %d: %s", set, pid, msg);
                    };
                  } else {
                    debugs[set] = function() {
                    };
                  }
                }
                return debugs[set];
              };
              function inspect(obj, opts) {
                var ctx2 = {
                  seen: [],
                  stylize: stylizeNoColor
                };
                if (arguments.length >= 3) ctx2.depth = arguments[2];
                if (arguments.length >= 4) ctx2.colors = arguments[3];
                if (isBoolean(opts)) {
                  ctx2.showHidden = opts;
                } else if (opts) {
                  exports3._extend(ctx2, opts);
                }
                if (isUndefined(ctx2.showHidden)) ctx2.showHidden = false;
                if (isUndefined(ctx2.depth)) ctx2.depth = 2;
                if (isUndefined(ctx2.colors)) ctx2.colors = false;
                if (isUndefined(ctx2.customInspect)) ctx2.customInspect = true;
                if (ctx2.colors) ctx2.stylize = stylizeWithColor;
                return formatValue(ctx2, obj, ctx2.depth);
              }
              exports3.inspect = inspect;
              inspect.colors = {
                "bold": [1, 22],
                "italic": [3, 23],
                "underline": [4, 24],
                "inverse": [7, 27],
                "white": [37, 39],
                "grey": [90, 39],
                "black": [30, 39],
                "blue": [34, 39],
                "cyan": [36, 39],
                "green": [32, 39],
                "magenta": [35, 39],
                "red": [31, 39],
                "yellow": [33, 39]
              };
              inspect.styles = {
                "special": "cyan",
                "number": "yellow",
                "boolean": "yellow",
                "undefined": "grey",
                "null": "bold",
                "string": "green",
                "date": "magenta",
                // "name": intentionally not styling
                "regexp": "red"
              };
              function stylizeWithColor(str, styleType) {
                var style = inspect.styles[styleType];
                if (style) {
                  return "\x1B[" + inspect.colors[style][0] + "m" + str + "\x1B[" + inspect.colors[style][1] + "m";
                } else {
                  return str;
                }
              }
              function stylizeNoColor(str, styleType) {
                return str;
              }
              function arrayToHash(array) {
                var hash = {};
                array.forEach(function(val2, idx) {
                  hash[val2] = true;
                });
                return hash;
              }
              function formatValue(ctx2, value, recurseTimes) {
                if (ctx2.customInspect && value && isFunction(value.inspect) && // Filter out the util module, it's inspect function is special
                value.inspect !== exports3.inspect && // Also filter out any prototype objects using the circular check.
                !(value.constructor && value.constructor.prototype === value)) {
                  var ret = value.inspect(recurseTimes, ctx2);
                  if (!isString(ret)) {
                    ret = formatValue(ctx2, ret, recurseTimes);
                  }
                  return ret;
                }
                var primitive = formatPrimitive(ctx2, value);
                if (primitive) {
                  return primitive;
                }
                var keys = Object.keys(value);
                var visibleKeys = arrayToHash(keys);
                if (ctx2.showHidden) {
                  keys = Object.getOwnPropertyNames(value);
                }
                if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
                  return formatError(value);
                }
                if (keys.length === 0) {
                  if (isFunction(value)) {
                    var name = value.name ? ": " + value.name : "";
                    return ctx2.stylize("[Function" + name + "]", "special");
                  }
                  if (isRegExp(value)) {
                    return ctx2.stylize(RegExp.prototype.toString.call(value), "regexp");
                  }
                  if (isDate(value)) {
                    return ctx2.stylize(Date.prototype.toString.call(value), "date");
                  }
                  if (isError(value)) {
                    return formatError(value);
                  }
                }
                var base = "", array = false, braces = ["{", "}"];
                if (isArray(value)) {
                  array = true;
                  braces = ["[", "]"];
                }
                if (isFunction(value)) {
                  var n = value.name ? ": " + value.name : "";
                  base = " [Function" + n + "]";
                }
                if (isRegExp(value)) {
                  base = " " + RegExp.prototype.toString.call(value);
                }
                if (isDate(value)) {
                  base = " " + Date.prototype.toUTCString.call(value);
                }
                if (isError(value)) {
                  base = " " + formatError(value);
                }
                if (keys.length === 0 && (!array || value.length == 0)) {
                  return braces[0] + base + braces[1];
                }
                if (recurseTimes < 0) {
                  if (isRegExp(value)) {
                    return ctx2.stylize(RegExp.prototype.toString.call(value), "regexp");
                  } else {
                    return ctx2.stylize("[Object]", "special");
                  }
                }
                ctx2.seen.push(value);
                var output;
                if (array) {
                  output = formatArray(ctx2, value, recurseTimes, visibleKeys, keys);
                } else {
                  output = keys.map(function(key) {
                    return formatProperty(ctx2, value, recurseTimes, visibleKeys, key, array);
                  });
                }
                ctx2.seen.pop();
                return reduceToSingleString(output, base, braces);
              }
              function formatPrimitive(ctx2, value) {
                if (isUndefined(value))
                  return ctx2.stylize("undefined", "undefined");
                if (isString(value)) {
                  var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
                  return ctx2.stylize(simple, "string");
                }
                if (isNumber(value))
                  return ctx2.stylize("" + value, "number");
                if (isBoolean(value))
                  return ctx2.stylize("" + value, "boolean");
                if (isNull(value))
                  return ctx2.stylize("null", "null");
              }
              function formatError(value) {
                return "[" + Error.prototype.toString.call(value) + "]";
              }
              function formatArray(ctx2, value, recurseTimes, visibleKeys, keys) {
                var output = [];
                for (var i = 0, l = value.length; i < l; ++i) {
                  if (hasOwnProperty(value, String(i))) {
                    output.push(formatProperty(
                      ctx2,
                      value,
                      recurseTimes,
                      visibleKeys,
                      String(i),
                      true
                    ));
                  } else {
                    output.push("");
                  }
                }
                keys.forEach(function(key) {
                  if (!key.match(/^\d+$/)) {
                    output.push(formatProperty(
                      ctx2,
                      value,
                      recurseTimes,
                      visibleKeys,
                      key,
                      true
                    ));
                  }
                });
                return output;
              }
              function formatProperty(ctx2, value, recurseTimes, visibleKeys, key, array) {
                var name, str, desc;
                desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
                if (desc.get) {
                  if (desc.set) {
                    str = ctx2.stylize("[Getter/Setter]", "special");
                  } else {
                    str = ctx2.stylize("[Getter]", "special");
                  }
                } else {
                  if (desc.set) {
                    str = ctx2.stylize("[Setter]", "special");
                  }
                }
                if (!hasOwnProperty(visibleKeys, key)) {
                  name = "[" + key + "]";
                }
                if (!str) {
                  if (ctx2.seen.indexOf(desc.value) < 0) {
                    if (isNull(recurseTimes)) {
                      str = formatValue(ctx2, desc.value, null);
                    } else {
                      str = formatValue(ctx2, desc.value, recurseTimes - 1);
                    }
                    if (str.indexOf("\n") > -1) {
                      if (array) {
                        str = str.split("\n").map(function(line) {
                          return "  " + line;
                        }).join("\n").slice(2);
                      } else {
                        str = "\n" + str.split("\n").map(function(line) {
                          return "   " + line;
                        }).join("\n");
                      }
                    }
                  } else {
                    str = ctx2.stylize("[Circular]", "special");
                  }
                }
                if (isUndefined(name)) {
                  if (array && key.match(/^\d+$/)) {
                    return str;
                  }
                  name = JSON.stringify("" + key);
                  if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
                    name = name.slice(1, -1);
                    name = ctx2.stylize(name, "name");
                  } else {
                    name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
                    name = ctx2.stylize(name, "string");
                  }
                }
                return name + ": " + str;
              }
              function reduceToSingleString(output, base, braces) {
                var numLinesEst = 0;
                var length = output.reduce(function(prev, cur) {
                  numLinesEst++;
                  if (cur.indexOf("\n") >= 0) numLinesEst++;
                  return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
                }, 0);
                if (length > 60) {
                  return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
                }
                return braces[0] + base + " " + output.join(", ") + " " + braces[1];
              }
              exports3.types = require2("./support/types");
              function isArray(ar) {
                return Array.isArray(ar);
              }
              exports3.isArray = isArray;
              function isBoolean(arg) {
                return typeof arg === "boolean";
              }
              exports3.isBoolean = isBoolean;
              function isNull(arg) {
                return arg === null;
              }
              exports3.isNull = isNull;
              function isNullOrUndefined(arg) {
                return arg == null;
              }
              exports3.isNullOrUndefined = isNullOrUndefined;
              function isNumber(arg) {
                return typeof arg === "number";
              }
              exports3.isNumber = isNumber;
              function isString(arg) {
                return typeof arg === "string";
              }
              exports3.isString = isString;
              function isSymbol(arg) {
                return typeof arg === "symbol";
              }
              exports3.isSymbol = isSymbol;
              function isUndefined(arg) {
                return arg === void 0;
              }
              exports3.isUndefined = isUndefined;
              function isRegExp(re) {
                return isObject(re) && objectToString(re) === "[object RegExp]";
              }
              exports3.isRegExp = isRegExp;
              exports3.types.isRegExp = isRegExp;
              function isObject(arg) {
                return typeof arg === "object" && arg !== null;
              }
              exports3.isObject = isObject;
              function isDate(d) {
                return isObject(d) && objectToString(d) === "[object Date]";
              }
              exports3.isDate = isDate;
              exports3.types.isDate = isDate;
              function isError(e) {
                return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error);
              }
              exports3.isError = isError;
              exports3.types.isNativeError = isError;
              function isFunction(arg) {
                return typeof arg === "function";
              }
              exports3.isFunction = isFunction;
              function isPrimitive(arg) {
                return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || // ES6 symbol
                typeof arg === "undefined";
              }
              exports3.isPrimitive = isPrimitive;
              exports3.isBuffer = require2("./support/isBuffer");
              function objectToString(o) {
                return Object.prototype.toString.call(o);
              }
              function pad(n) {
                return n < 10 ? "0" + n.toString(10) : n.toString(10);
              }
              var months = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec"
              ];
              function timestamp() {
                var d = /* @__PURE__ */ new Date();
                var time = [
                  pad(d.getHours()),
                  pad(d.getMinutes()),
                  pad(d.getSeconds())
                ].join(":");
                return [d.getDate(), months[d.getMonth()], time].join(" ");
              }
              exports3.log = function() {
                console.log("%s - %s", timestamp(), exports3.format.apply(exports3, arguments));
              };
              exports3.inherits = require2("inherits");
              exports3._extend = function(origin, add) {
                if (!add || !isObject(add)) return origin;
                var keys = Object.keys(add);
                var i = keys.length;
                while (i--) {
                  origin[keys[i]] = add[keys[i]];
                }
                return origin;
              };
              function hasOwnProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop);
              }
              var kCustomPromisifiedSymbol = typeof Symbol !== "undefined" ? Symbol("util.promisify.custom") : void 0;
              exports3.promisify = function promisify(original) {
                if (typeof original !== "function")
                  throw new TypeError('The "original" argument must be of type Function');
                if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
                  var fn = original[kCustomPromisifiedSymbol];
                  if (typeof fn !== "function") {
                    throw new TypeError('The "util.promisify.custom" argument must be of type Function');
                  }
                  Object.defineProperty(fn, kCustomPromisifiedSymbol, {
                    value: fn,
                    enumerable: false,
                    writable: false,
                    configurable: true
                  });
                  return fn;
                }
                function fn() {
                  var promiseResolve, promiseReject;
                  var promise = new Promise(function(resolve, reject) {
                    promiseResolve = resolve;
                    promiseReject = reject;
                  });
                  var args = [];
                  for (var i = 0; i < arguments.length; i++) {
                    args.push(arguments[i]);
                  }
                  args.push(function(err, value) {
                    if (err) {
                      promiseReject(err);
                    } else {
                      promiseResolve(value);
                    }
                  });
                  try {
                    original.apply(this, args);
                  } catch (err) {
                    promiseReject(err);
                  }
                  return promise;
                }
                Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
                if (kCustomPromisifiedSymbol) Object.defineProperty(fn, kCustomPromisifiedSymbol, {
                  value: fn,
                  enumerable: false,
                  writable: false,
                  configurable: true
                });
                return Object.defineProperties(
                  fn,
                  getOwnPropertyDescriptors(original)
                );
              };
              exports3.promisify.custom = kCustomPromisifiedSymbol;
              function callbackifyOnRejected(reason, cb) {
                if (!reason) {
                  var newReason = new Error("Promise was rejected with a falsy value");
                  newReason.reason = reason;
                  reason = newReason;
                }
                return cb(reason);
              }
              function callbackify(original) {
                if (typeof original !== "function") {
                  throw new TypeError('The "original" argument must be of type Function');
                }
                function callbackified() {
                  var args = [];
                  for (var i = 0; i < arguments.length; i++) {
                    args.push(arguments[i]);
                  }
                  var maybeCb = args.pop();
                  if (typeof maybeCb !== "function") {
                    throw new TypeError("The last argument must be of type Function");
                  }
                  var self2 = this;
                  var cb = function() {
                    return maybeCb.apply(self2, arguments);
                  };
                  original.apply(this, args).then(
                    function(ret) {
                      process.nextTick(cb.bind(null, null, ret));
                    },
                    function(rej) {
                      process.nextTick(callbackifyOnRejected.bind(null, rej, cb));
                    }
                  );
                }
                Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
                Object.defineProperties(
                  callbackified,
                  getOwnPropertyDescriptors(original)
                );
                return callbackified;
              }
              exports3.callbackify = callbackify;
            }).call(this);
          }).call(this, require2("_process"));
        }, { "./support/isBuffer": 82, "./support/types": 83, "_process": 63, "inherits": 46 }], 85: [function(require2, module3, exports3) {
          (function(global2) {
            (function() {
              "use strict";
              var forEach = require2("for-each");
              var availableTypedArrays = require2("available-typed-arrays");
              var callBound = require2("call-bind/callBound");
              var gOPD = require2("gopd");
              var $toString = callBound("Object.prototype.toString");
              var hasToStringTag = require2("has-tostringtag/shams")();
              var g = typeof globalThis === "undefined" ? global2 : globalThis;
              var typedArrays = availableTypedArrays();
              var $slice = callBound("String.prototype.slice");
              var toStrTags = {};
              var getPrototypeOf = Object.getPrototypeOf;
              if (hasToStringTag && gOPD && getPrototypeOf) {
                forEach(typedArrays, function(typedArray) {
                  if (typeof g[typedArray] === "function") {
                    var arr = new g[typedArray]();
                    if (Symbol.toStringTag in arr) {
                      var proto = getPrototypeOf(arr);
                      var descriptor = gOPD(proto, Symbol.toStringTag);
                      if (!descriptor) {
                        var superProto = getPrototypeOf(proto);
                        descriptor = gOPD(superProto, Symbol.toStringTag);
                      }
                      toStrTags[typedArray] = descriptor.get;
                    }
                  }
                });
              }
              var tryTypedArrays = function tryAllTypedArrays(value) {
                var foundName = false;
                forEach(toStrTags, function(getter, typedArray) {
                  if (!foundName) {
                    try {
                      var name = getter.call(value);
                      if (name === typedArray) {
                        foundName = name;
                      }
                    } catch (e) {
                    }
                  }
                });
                return foundName;
              };
              var isTypedArray = require2("is-typed-array");
              module3.exports = function whichTypedArray(value) {
                if (!isTypedArray(value)) {
                  return false;
                }
                if (!hasToStringTag || !(Symbol.toStringTag in value)) {
                  return $slice($toString(value), 8, -1);
                }
                return tryTypedArrays(value);
              };
            }).call(this);
          }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, { "available-typed-arrays": 27, "call-bind/callBound": 33, "for-each": 36, "gopd": 40, "has-tostringtag/shams": 43, "is-typed-array": 50 }] }, {}, [20])(20);
      });
    }
  });

  // package/library/src/DjVu.js
  var DjVu = {
    VERSION: "0.5.4",
    IS_DEBUG: false,
    setDebugMode: (flag) => DjVu.IS_DEBUG = flag
  };
  function pLimit(limit = 4) {
    const queue = [];
    let running = 0;
    const runNext = async () => {
      if (!queue.length || running >= limit) return;
      const func = queue.shift();
      try {
        running++;
        await func();
      } finally {
        running--;
        runNext();
      }
    };
    return (func) => new Promise((resolve, reject) => {
      queue.push(() => func().then(resolve, reject));
      runNext();
    });
  }
  function loadFileViaXHR(url, responseType = "arraybuffer") {
    return new Promise((resolve, reject) => {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.responseType = responseType;
      xhr.onload = (e) => resolve(xhr);
      xhr.onerror = (e) => reject(xhr);
      xhr.send();
    });
  }
  var utf8Decoder = self.TextDecoder ? new self.TextDecoder() : {
    decode(utf8array) {
      const codePoints = utf8ToCodePoints(utf8array);
      return String.fromCodePoint(...codePoints);
    }
  };
  function createStringFromUtf8Array(utf8array) {
    return utf8Decoder.decode(utf8array);
  }
  function utf8ToCodePoints(utf8array) {
    var i, c;
    var codePoints = [];
    i = 0;
    while (i < utf8array.length) {
      c = utf8array[i++];
      switch (c >> 4) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
          codePoints.push(c);
          break;
        case 12:
        case 13:
          codePoints.push((c & 31) << 6 | utf8array[i++] & 63);
          break;
        case 14:
          codePoints.push(
            (c & 15) << 12 | (utf8array[i++] & 63) << 6 | utf8array[i++] & 63
          );
          break;
        case 15:
          codePoints.push(
            (c & 7) << 18 | (utf8array[i++] & 63) << 12 | (utf8array[i++] & 63) << 6 | utf8array[i++] & 63
          );
          break;
      }
    }
    return codePoints.map((codePoint) => {
      return codePoint > 1114111 ? 120 : codePoint;
    });
  }
  function codePointsToUtf8(codePoints) {
    var utf8array = [];
    codePoints.forEach((codePoint) => {
      if (codePoint < 128) {
        utf8array.push(codePoint);
      } else if (codePoint < 2048) {
        utf8array.push(192 | codePoint >> 6);
        utf8array.push(128 | codePoint & 63);
      } else if (codePoint < 65536) {
        utf8array.push(224 | codePoint >> 12);
        utf8array.push(128 | codePoint >> 6 & 63);
        utf8array.push(128 | codePoint & 63);
      } else {
        utf8array.push(240 | codePoint >> 18);
        utf8array.push(128 | codePoint >> 12 & 63);
        utf8array.push(128 | codePoint >> 6 & 63);
        utf8array.push(128 | codePoint & 63);
      }
    });
    return new Uint8Array(utf8array);
  }
  function stringToCodePoints(str) {
    var codePoints = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      codePoints.push(code);
      if (code > 65535) {
        i++;
      }
    }
    return codePoints;
  }
  var DjVu_default = DjVu;

  // package/library/src/ByteStreamWriter.js
  var pageSize = 64 * 1024;
  var growthLimit = 20 * 1024 * 1024 / pageSize;
  var ByteStreamWriter = class {
    constructor(length = 0) {
      this.memory = new WebAssembly.Memory({ initial: Math.ceil(length / pageSize), maximum: 65536 });
      this.assignBufferFromMemory();
      this.offset = 0;
      this.offsetMarks = {};
    }
    assignBufferFromMemory() {
      this.buffer = this.memory.buffer;
      this.viewer = new DataView(this.buffer);
    }
    /**
     * Переводит смещение на начало и зачищает сохраненные смещения
     */
    reset() {
      this.offset = 0;
      this.offsetMarks = {};
    }
    saveOffsetMark(mark) {
      this.offsetMarks[mark] = this.offset;
      return this;
    }
    writeByte(byte) {
      this.checkOffset(1);
      this.viewer.setUint8(this.offset++, byte);
      return this;
    }
    writeStr(str) {
      this.writeArray(codePointsToUtf8(stringToCodePoints(str)));
      return this;
    }
    writeInt32(val2) {
      this.checkOffset(4);
      this.viewer.setInt32(this.offset, val2);
      this.offset += 4;
      return this;
    }
    /**
     * Перезапись числа. Принимает смещение или метку смещения и число
     */
    rewriteInt32(off, val2) {
      var xoff = off;
      if (typeof xoff === "string") {
        xoff = this.offsetMarks[off];
        this.offsetMarks[off] += 4;
      }
      this.viewer.setInt32(xoff, val2);
    }
    /**
     * Перезапись размера в 4 байта по сохраненной метке
     */
    rewriteSize(offmark) {
      if (!this.offsetMarks[offmark]) throw new Error("Unexisting offset mark");
      var xoff = this.offsetMarks[offmark];
      this.viewer.setInt32(xoff, this.offset - xoff - 4);
    }
    getBuffer() {
      if (this.offset === this.buffer.byteLength) {
        return this.buffer;
      }
      return this.buffer.slice(0, this.offset);
    }
    checkOffset(requiredBytesNumber = 0) {
      const bool = this.offset + requiredBytesNumber > this.buffer.byteLength;
      if (bool) {
        this._expand(requiredBytesNumber);
      }
      return bool;
    }
    _expand(requiredBytesNumber) {
      this.memory.grow(Math.max(
        Math.ceil(requiredBytesNumber / pageSize),
        Math.min(this.memory.buffer.byteLength / pageSize, growthLimit)
      ));
      this.assignBufferFromMemory();
    }
    //смещение на length байт
    jump(length) {
      length = +length;
      if (length > 0) {
        this.checkOffset(length);
      }
      this.offset += length;
      return this;
    }
    writeByteStream(bs) {
      this.writeArray(bs.toUint8Array());
    }
    writeArray(arr) {
      while (this.checkOffset(arr.length)) {
      }
      new Uint8Array(this.buffer).set(arr, this.offset);
      this.offset += arr.length;
    }
    writeBuffer(buffer) {
      this.writeArray(new Uint8Array(buffer));
    }
    writeStrNT(str) {
      this.writeStr(str);
      this.writeByte(0);
    }
    writeInt16(val2) {
      this.checkOffset(2);
      this.viewer.setInt16(this.offset, val2);
      this.offset += 2;
      return this;
    }
    writeUint16(val2) {
      this.checkOffset(2);
      this.viewer.setUint16(this.offset, val2);
      this.offset += 2;
      return this;
    }
    writeInt24(val2) {
      this.writeByte(val2 >> 16 & 255).writeByte(val2 >> 8 & 255).writeByte(val2 & 255);
      return this;
    }
  };

  // package/library/src/ZPCodec.js
  var ZPEncoder = class {
    constructor(bsw) {
      this.bsw = bsw || new ByteStreamWriter();
      this.a = 0;
      this.scount = 0;
      this.byte = 0;
      this.delay = 25;
      this.subend = 0;
      this.buffer = 16777215;
      this.nrun = 0;
    }
    outbit(bit) {
      if (this.delay > 0) {
        if (this.delay < 255)
          this.delay -= 1;
      } else {
        this.byte = this.byte << 1 | bit;
        if (++this.scount == 8) {
          this.bsw.writeByte(this.byte);
          this.scount = 0;
          this.byte = 0;
        }
      }
    }
    zemit(b) {
      this.buffer = (this.buffer << 1) + b;
      b = this.buffer >> 24;
      this.buffer = this.buffer & 16777215;
      switch (b) {
        case 1:
          this.outbit(1);
          while (this.nrun-- > 0)
            this.outbit(0);
          this.nrun = 0;
          break;
        case 255:
          this.outbit(0);
          while (this.nrun-- > 0)
            this.outbit(1);
          this.nrun = 0;
          break;
        case 0:
          this.nrun += 1;
          break;
        default:
          throw new Exception("ZPEncoder::zemit() error!");
      }
    }
    //откопировано из djvulibre
    encode(bit, ctx2, n) {
      bit = +bit;
      if (!ctx2) {
        return this._ptencode(bit, 32768 + (this.a >> 1));
      }
      var z = this.a + this.p[ctx2[n]];
      if (bit != (ctx2[n] & 1)) {
        var d = 24576 + (z + this.a >> 2);
        if (z > d) {
          z = d;
        }
        ctx2[n] = this.dn[ctx2[n]];
        z = 65536 - z;
        this.subend += z;
        this.a += z;
      } else if (z >= 32768) {
        var d = 24576 + (z + this.a >> 2);
        if (z > d) {
          z = d;
        }
        if (this.a >= this.m[ctx2[n]])
          ctx2[n] = this.up[ctx2[n]];
        this.a = z;
      } else {
        this.a = z;
        return;
      }
      while (this.a >= 32768) {
        this.zemit(1 - (this.subend >> 15));
        this.subend = 65535 & this.subend << 1;
        this.a = 65535 & this.a << 1;
      }
    }
    //используется для кодирования изображений, может всегда использоваться как показала практика
    IWencode(bit) {
      this._ptencode(bit, 32768 + (this.a + this.a + this.a >> 3));
    }
    // тут скопировано с IWEncoder() может нужен просто Encoder()
    _ptencode(bit, z) {
      if (bit) {
        z = 65536 - z;
        this.subend += z;
        this.a += z;
      } else {
        this.a = z;
      }
      while (this.a >= 32768) {
        this.zemit(1 - (this.subend >> 15));
        this.subend = 65535 & this.subend << 1;
        this.a = 65535 & this.a << 1;
      }
    }
    // функция выполняемая в деструкторе в С++. Надо вызывать вручную в js чтобы записать последние байты
    eflush() {
      if (this.subend > 32768)
        this.subend = 65536;
      else if (this.subend > 0)
        this.subend = 32768;
      while (this.buffer != 16777215 || this.subend) {
        this.zemit(1 - (this.subend >> 15));
        this.subend = 65535 & this.subend << 1;
      }
      this.outbit(1);
      while (this.nrun-- > 0)
        this.outbit(0);
      this.nrun = 0;
      while (this.scount > 0)
        this.outbit(1);
      this.delay = 255;
    }
  };
  var ZPDecoder = class {
    constructor(bs) {
      this.bs = bs;
      this.a = 0;
      this.c = this.bs.byte();
      this.c <<= 8;
      var tmp = this.bs.byte();
      this.c |= tmp;
      this.z = 0;
      this.d = 0;
      this.f = Math.min(this.c, 32767);
      this.ffzt = new Int8Array(256);
      for (var i = 0; i < 256; i++) {
        this.ffzt[i] = 0;
        for (var j = i; j & 128; j <<= 1)
          this.ffzt[i] += 1;
      }
      this.delay = 25;
      this.scount = 0;
      this.buffer = 0;
      this.preload();
    }
    preload() {
      while (this.scount <= 24) {
        var byte = this.bs.byte();
        this.buffer = this.buffer << 8 | byte;
        this.scount += 8;
      }
    }
    ffz(x) {
      return x >= 65280 ? this.ffzt[x & 255] + 8 : this.ffzt[x >> 8 & 255];
    }
    /* Функции реализованы не как в документации, а скопированы из djvulibre */
    decode(ctx2, n) {
      if (!ctx2) {
        return this._ptdecode(32768 + (this.a >> 1));
      }
      this.b = ctx2[n] & 1;
      this.z = this.a + this.p[ctx2[n]];
      if (this.z <= this.f) {
        this.a = this.z;
        return this.b;
      }
      this.d = 24576 + (this.a + this.z >> 2);
      if (this.z > this.d) {
        this.z = this.d;
      }
      if (this.z > this.c) {
        this.b = 1 - this.b;
        this.z = 65536 - this.z;
        this.a += this.z;
        this.c += this.z;
        ctx2[n] = this.dn[ctx2[n]];
        var shift = this.ffz(this.a);
        this.scount -= shift;
        this.a = 65535 & this.a << shift;
        this.c = 65535 & (this.c << shift | this.buffer >> this.scount & (1 << shift) - 1);
      } else {
        if (this.a >= this.m[ctx2[n]]) {
          ctx2[n] = this.up[ctx2[n]];
        }
        this.scount--;
        this.a = 65535 & this.z << 1;
        this.c = 65535 & (this.c << 1 | this.buffer >> this.scount & 1);
      }
      if (this.scount < 16)
        this.preload();
      this.f = Math.min(this.c, 32767);
      return this.b;
    }
    // для раскодирования картинок, но вообще можно всегда использовать
    IWdecode() {
      return this._ptdecode(32768 + (this.a + this.a + this.a >> 3));
    }
    _ptdecode(z) {
      this.b = 0;
      if (z > this.c) {
        this.b = 1;
        z = 65536 - z;
        this.a += z;
        this.c += z;
        var shift = this.ffz(this.a);
        this.scount -= shift;
        this.a = 65535 & this.a << shift;
        this.c = 65535 & (this.c << shift | this.buffer >> this.scount & (1 << shift) - 1);
      } else {
        this.b = 0;
        this.scount--;
        this.a = 65535 & z << 1;
        this.c = 65535 & (this.c << 1 | this.buffer >> this.scount & 1);
      }
      if (this.scount < 16)
        this.preload();
      this.f = Math.min(this.c, 32767);
      return this.b;
    }
    /*decodex(ctx, n) {
        if (!ctx) {
            return this.ptdecode();
        }
        this.b = ctx[n] & 1;
        this.z = this.a + this.p[ctx[n]];
        if (this.z <= this.f) {
            this.a = this.z;
            //console.log("123");
            return this.b;
        }
        this.d = 0x6000 + ((this.a + this.z) >> 2);
        
        if (this.z > this.d) {
            this.z = this.d;
        }
        if (this.c > this.z) {
            if (this.a > this.m[ctx[n]]) {
                ctx[n] = this.up[ctx[n]];
            }
            this.a = this.z;
        } 
        else {
            this.b = 1 - this.b;
            this.z = 0x10000 - this.z;
            this.a += this.z;
            this.c += this.z;
            ctx[n] = this.dn[ctx[n]];
        }
        var flag = 0;
        while (this.a > 0x8000) {
            flag = 1;
            this.a += this.a - 0x10000;
            this.c += this.c - 0x10000 + this.bs.bit();
            //console.log("+");
        }
        if (flag) {
            this.f = Math.min(this.c, 0x7fff);
        } 
        else {
           // console.log("()");
        }
        return this.b;
    }*/
    /*ptdecodex() {
        this.z = 0x8000 + ((this.a + this.a + this.a) >> 3);
        if (this.c > this.z) {
            this.b = 0;
            this.a = this.z;
        } 
        else {
            this.b = 1;
            this.z = 0x10000 - this.z;
            this.a += this.z;
            this.c += this.z;
        }
        while (this.a > 0x8000) {
            this.a += this.a - 0x10000;
            this.c += this.c - 0x10000 + this.bs.bit();
        }
        return this.b;
    }*/
  };
  ZPEncoder.prototype.p = ZPDecoder.prototype.p = Uint16Array.of(
    32768,
    32768,
    32768,
    27581,
    27581,
    23877,
    23877,
    20921,
    20921,
    18451,
    18451,
    16341,
    16341,
    14513,
    14513,
    12917,
    12917,
    11517,
    11517,
    10277,
    10277,
    9131,
    9131,
    8071,
    8071,
    7099,
    7099,
    6213,
    6213,
    5411,
    5411,
    4691,
    4691,
    4047,
    4047,
    3477,
    3477,
    2973,
    2973,
    2531,
    2531,
    2145,
    2145,
    1809,
    1809,
    1521,
    1521,
    1273,
    1273,
    1061,
    1061,
    881,
    881,
    729,
    729,
    601,
    601,
    493,
    493,
    403,
    403,
    329,
    329,
    267,
    267,
    213,
    213,
    165,
    165,
    123,
    123,
    87,
    87,
    59,
    59,
    35,
    35,
    19,
    19,
    7,
    7,
    1,
    1,
    22165,
    9454,
    32768,
    3376,
    18458,
    1153,
    13689,
    378,
    9455,
    123,
    6520,
    40,
    4298,
    13,
    2909,
    52,
    1930,
    160,
    1295,
    279,
    856,
    490,
    564,
    324,
    371,
    564,
    245,
    851,
    161,
    1477,
    282,
    975,
    426,
    645,
    646,
    427,
    979,
    282,
    1477,
    186,
    2221,
    122,
    3276,
    491,
    4866,
    742,
    7041,
    1118,
    9455,
    1680,
    10341,
    2526,
    14727,
    3528,
    11417,
    4298,
    15199,
    2909,
    22165,
    1930,
    32768,
    1295,
    9454,
    856,
    3376,
    564,
    1153,
    371,
    378,
    245,
    123,
    161,
    40,
    282,
    13,
    426,
    52,
    646,
    160,
    979,
    279,
    1477,
    490,
    2221,
    324,
    3276,
    564,
    4866,
    851,
    7041,
    1477,
    9455,
    975,
    11124,
    645,
    8221,
    427,
    5909,
    282,
    4023,
    186,
    2663,
    491,
    1767,
    742,
    1174,
    1118,
    781,
    1680,
    518,
    2526,
    341,
    3528,
    225,
    11124,
    148,
    8221,
    392,
    5909,
    594,
    4023,
    899,
    2663,
    1351,
    1767,
    2018,
    1174,
    3008,
    781,
    4472,
    518,
    6618,
    341,
    9455,
    225,
    12814,
    148,
    17194,
    392,
    17533,
    594,
    24270,
    899,
    32768,
    1351,
    18458,
    2018,
    13689,
    3008,
    9455,
    4472,
    6520,
    6618,
    10341,
    9455,
    14727,
    12814,
    11417,
    17194,
    15199,
    17533,
    22165,
    24270,
    32768,
    32768,
    22165,
    18458,
    18458
  );
  ZPEncoder.prototype.m = ZPDecoder.prototype.m = Uint16Array.of(
    0,
    0,
    0,
    4261,
    4261,
    7976,
    7976,
    11219,
    11219,
    14051,
    14051,
    16524,
    16524,
    18685,
    18685,
    20573,
    20573,
    22224,
    22224,
    23665,
    23665,
    24923,
    24923,
    26021,
    26021,
    26978,
    26978,
    27810,
    27810,
    28532,
    28532,
    29158,
    29158,
    29700,
    29700,
    30166,
    30166,
    30568,
    30568,
    30914,
    30914,
    31210,
    31210,
    31463,
    31463,
    31678,
    31678,
    31861,
    31861,
    32015,
    32015,
    32145,
    32145,
    32254,
    32254,
    32346,
    32346,
    32422,
    32422,
    32486,
    32486,
    32538,
    32538,
    32581,
    32581,
    32619,
    32619,
    32653,
    32653,
    32682,
    32682,
    32707,
    32707,
    32727,
    32727,
    32743,
    32743,
    32754,
    32754,
    32762,
    32762,
    32767,
    32767,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  );
  ZPEncoder.prototype.up = ZPDecoder.prototype.up = Uint8Array.of(
    84,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    39,
    40,
    41,
    42,
    43,
    44,
    45,
    46,
    47,
    48,
    49,
    50,
    51,
    52,
    53,
    54,
    55,
    56,
    57,
    58,
    59,
    60,
    61,
    62,
    63,
    64,
    65,
    66,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    75,
    76,
    77,
    78,
    79,
    80,
    81,
    82,
    81,
    82,
    9,
    86,
    5,
    88,
    89,
    90,
    91,
    92,
    93,
    94,
    95,
    96,
    97,
    82,
    99,
    76,
    101,
    70,
    103,
    66,
    105,
    106,
    107,
    66,
    109,
    60,
    111,
    56,
    69,
    114,
    65,
    116,
    61,
    118,
    57,
    120,
    53,
    122,
    49,
    124,
    43,
    72,
    39,
    60,
    33,
    56,
    29,
    52,
    23,
    48,
    23,
    42,
    137,
    38,
    21,
    140,
    15,
    142,
    9,
    144,
    141,
    146,
    147,
    148,
    149,
    150,
    151,
    152,
    153,
    154,
    155,
    70,
    157,
    66,
    81,
    62,
    75,
    58,
    69,
    54,
    65,
    50,
    167,
    44,
    65,
    40,
    59,
    34,
    55,
    30,
    175,
    24,
    177,
    178,
    179,
    180,
    181,
    182,
    183,
    184,
    69,
    186,
    59,
    188,
    55,
    190,
    51,
    192,
    47,
    194,
    41,
    196,
    37,
    198,
    199,
    72,
    201,
    62,
    203,
    58,
    205,
    54,
    207,
    50,
    209,
    46,
    211,
    40,
    213,
    36,
    215,
    30,
    217,
    26,
    219,
    20,
    71,
    14,
    61,
    14,
    57,
    8,
    53,
    228,
    49,
    230,
    45,
    232,
    39,
    234,
    35,
    138,
    29,
    24,
    25,
    240,
    19,
    22,
    13,
    16,
    13,
    10,
    7,
    244,
    249,
    10,
    89,
    230
  );
  ZPEncoder.prototype.dn = ZPDecoder.prototype.dn = Uint8Array.of(
    145,
    4,
    3,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    39,
    40,
    41,
    42,
    43,
    44,
    45,
    46,
    47,
    48,
    49,
    50,
    51,
    52,
    53,
    54,
    55,
    56,
    57,
    58,
    59,
    60,
    61,
    62,
    63,
    64,
    65,
    66,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    75,
    76,
    77,
    78,
    79,
    80,
    85,
    226,
    6,
    176,
    143,
    138,
    141,
    112,
    135,
    104,
    133,
    100,
    129,
    98,
    127,
    72,
    125,
    102,
    123,
    60,
    121,
    110,
    119,
    108,
    117,
    54,
    115,
    48,
    113,
    134,
    59,
    132,
    55,
    130,
    51,
    128,
    47,
    126,
    41,
    62,
    37,
    66,
    31,
    54,
    25,
    50,
    131,
    46,
    17,
    40,
    15,
    136,
    7,
    32,
    139,
    172,
    9,
    170,
    85,
    168,
    248,
    166,
    247,
    164,
    197,
    162,
    95,
    160,
    173,
    158,
    165,
    156,
    161,
    60,
    159,
    56,
    71,
    52,
    163,
    48,
    59,
    42,
    171,
    38,
    169,
    32,
    53,
    26,
    47,
    174,
    193,
    18,
    191,
    222,
    189,
    218,
    187,
    216,
    185,
    214,
    61,
    212,
    53,
    210,
    49,
    208,
    45,
    206,
    39,
    204,
    195,
    202,
    31,
    200,
    243,
    64,
    239,
    56,
    237,
    52,
    235,
    48,
    233,
    44,
    231,
    38,
    229,
    34,
    227,
    28,
    225,
    22,
    223,
    16,
    221,
    220,
    63,
    8,
    55,
    224,
    51,
    2,
    47,
    87,
    43,
    246,
    37,
    244,
    33,
    238,
    27,
    236,
    21,
    16,
    15,
    8,
    241,
    242,
    7,
    10,
    245,
    2,
    1,
    83,
    250,
    2,
    143,
    246
  );

  // package/library/src/jb2/JB2Structures.js
  var Bitmap = class _Bitmap {
    constructor(width, height) {
      var length = Math.ceil(width * height / 8);
      this.height = height;
      this.width = width;
      this.innerArray = new Uint8Array(length);
    }
    getBits(i, j, bitNumber) {
      if (!this.hasRow(i) || j >= this.width) {
        return 0;
      }
      if (j < 0) {
        bitNumber += j;
        j = 0;
      }
      var tmp = i * this.width + j;
      var index = tmp >> 3;
      var bitIndex = tmp & 7;
      var mask = 32768 >>> bitIndex;
      var twoBytes = this.innerArray[index] << 8 | (this.innerArray[index + 1] || 0);
      var existingBits = this.width - j;
      var border = bitNumber < existingBits ? bitNumber : existingBits;
      for (var k = 1; k < border; k++) {
        mask |= 32768 >>> bitIndex + k;
      }
      return (twoBytes & mask) >>> 16 - bitIndex - bitNumber;
    }
    get(i, j) {
      if (!this.hasRow(i) || j < 0 || j >= this.width) {
        return 0;
      }
      var tmp = i * this.width + j;
      var index = tmp >> 3;
      var bitIndex = tmp & 7;
      var mask = 128 >> bitIndex;
      return this.innerArray[index] & mask ? 1 : 0;
    }
    set(i, j) {
      var tmp = i * this.width + j;
      var index = tmp >> 3;
      var bitIndex = tmp & 7;
      var mask = 128 >> bitIndex;
      this.innerArray[index] |= mask;
      return;
    }
    hasRow(r) {
      return r >= 0 && r < this.height;
    }
    removeEmptyEdges() {
      var bottomShift = 0;
      var topShift = 0;
      var leftShift = 0;
      var rightShift = 0;
      main_cycle: for (var i = 0; i < this.height; i++) {
        for (var j = 0; j < this.width; j++) {
          if (this.get(i, j)) {
            break main_cycle;
          }
        }
        bottomShift++;
      }
      main_cycle: for (var i = this.height - 1; i >= 0; i--) {
        for (var j = 0; j < this.width; j++) {
          if (this.get(i, j)) {
            break main_cycle;
          }
        }
        topShift++;
      }
      main_cycle: for (var j = 0; j < this.width; j++) {
        for (var i = 0; i < this.height; i++) {
          if (this.get(i, j)) {
            break main_cycle;
          }
        }
        leftShift++;
      }
      main_cycle: for (var j = this.width - 1; j >= 0; j--) {
        for (var i = 0; i < this.height; i++) {
          if (this.get(i, j)) {
            break main_cycle;
          }
        }
        rightShift++;
      }
      if (topShift || bottomShift || leftShift || rightShift) {
        var newWidth = this.width - leftShift - rightShift;
        var newHeight = this.height - topShift - bottomShift;
        var newBitMap = new _Bitmap(newWidth, newHeight);
        for (var i = bottomShift, p = 0; p < newHeight; p++, i++) {
          for (var j = leftShift, q = 0; q < newWidth; q++, j++) {
            if (this.get(i, j)) {
              newBitMap.set(p, q);
            }
          }
        }
        return newBitMap;
      }
      return this;
    }
  };
  var NumContext = class _NumContext {
    constructor() {
      this.ctx = [0];
      this._left = null;
      this._right = null;
    }
    get left() {
      if (!this._left) {
        this._left = new _NumContext();
      }
      return this._left;
    }
    get right() {
      if (!this._right) {
        this._right = new _NumContext();
      }
      return this._right;
    }
  };
  var Baseline = class {
    constructor() {
      this.arr = new Array(3);
      this.fill(0);
      this.index = -1;
    }
    add(val2) {
      if (++this.index === 3) {
        this.index = 0;
      }
      this.arr[this.index] = val2;
    }
    getVal() {
      if (this.arr[0] >= this.arr[1] && this.arr[0] <= this.arr[2] || this.arr[0] <= this.arr[1] && this.arr[0] >= this.arr[2]) {
        return this.arr[0];
      } else if (this.arr[1] >= this.arr[0] && this.arr[1] <= this.arr[2] || this.arr[1] <= this.arr[0] && this.arr[1] >= this.arr[2]) {
        return this.arr[1];
      } else {
        return this.arr[2];
      }
    }
    fill(val2) {
      this.arr[0] = this.arr[1] = this.arr[2] = val2;
    }
  };

  // package/library/src/DjVuErrors.js
  var DjVuError = class {
    constructor(code, message, additionalData = null) {
      this.code = code;
      this.message = message;
      if (additionalData) this.additionalData = additionalData;
    }
  };
  var IncorrectFileFormatDjVuError = class extends DjVuError {
    constructor() {
      super(DjVuErrorCodes.INCORRECT_FILE_FORMAT, "The provided file is not a .djvu file!");
    }
  };
  var NoSuchPageDjVuError = class extends DjVuError {
    constructor(pageNumber) {
      super(DjVuErrorCodes.NO_SUCH_PAGE, "There is no page with the number " + pageNumber + " !");
      this.pageNumber = pageNumber;
    }
  };
  var CorruptedFileDjVuError = class extends DjVuError {
    constructor(message = "", data = null) {
      super(DjVuErrorCodes.FILE_IS_CORRUPTED, "The file is corrupted! " + message, data);
    }
  };
  var UnableToTransferDataDjVuError = class extends DjVuError {
    constructor(tasks) {
      super(
        DjVuErrorCodes.DATA_CANNOT_BE_TRANSFERRED,
        "The data cannot be transferred from the worker to the main page! Perhaps, you requested a complex object like DjVuPage, but only simple objects can be transferred between workers."
      );
      this.tasks = tasks;
    }
  };
  var IncorrectTaskDjVuError = class extends DjVuError {
    constructor(task) {
      super(DjVuErrorCodes.INCORRECT_TASK, "The task contains an incorrect sequence of functions!");
      this.task = task;
    }
  };
  var NoBaseUrlDjVuError = class extends DjVuError {
    constructor() {
      super(
        DjVuErrorCodes.NO_BASE_URL,
        "The base URL is required for the indirect djvu to load components, but no base URL was provided to the document constructor!"
      );
    }
  };
  function getErrorMessageByData(data) {
    var message = "";
    if (data.pageNumber) {
      if (data.dependencyId) {
        message = `A dependency ${data.dependencyId} for the page number ${data.pageNumber} can't be loaded!
`;
      } else {
        message = `The page number ${data.pageNumber} can't be loaded!`;
      }
    } else if (data.dependencyId) {
      message = `A dependency ${data.dependencyId} can't be loaded!
`;
    }
    return message;
  }
  var UnsuccessfulRequestDjVuError = class extends DjVuError {
    constructor(xhr, data = { pageNumber: null, dependencyId: null }) {
      var message = getErrorMessageByData(data);
      super(
        DjVuErrorCodes.UNSUCCESSFUL_REQUEST,
        message + `
The request to ${xhr.responseURL} wasn't successful.
The response status is ${xhr.status}.
The response status text is: "${xhr.statusText}".`
      );
      this.status = xhr.status;
      this.statusText = xhr.statusText;
      this.url = xhr.responseURL;
      if (data.pageNumber) {
        this.pageNumber = data.pageNumber;
      }
      if (data.dependencyId) {
        this.dependencyId = data.dependencyId;
      }
    }
  };
  var NetworkDjVuError = class extends DjVuError {
    constructor(data = { pageNumber: null, dependencyId: null, url: null }) {
      super(
        DjVuErrorCodes.NETWORK_ERROR,
        getErrorMessageByData(data) + "\nA network error occurred! Check your network connection!"
      );
      if (data.pageNumber) {
        this.pageNumber = data.pageNumber;
      }
      if (data.dependencyId) {
        this.dependencyId = data.dependencyId;
      }
      if (data.url) {
        this.url = data.url;
      }
    }
  };
  var DjVuErrorCodes = Object.freeze({
    FILE_IS_CORRUPTED: "FILE_IS_CORRUPTED",
    INCORRECT_FILE_FORMAT: "INCORRECT_FILE_FORMAT",
    NO_SUCH_PAGE: "NO_SUCH_PAGE",
    UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
    DATA_CANNOT_BE_TRANSFERRED: "DATA_CANNOT_BE_TRANSFERRED",
    INCORRECT_TASK: "INCORRECT_TASK",
    NO_BASE_URL: "NO_BASE_URL",
    NETWORK_ERROR: "NETWORK_ERROR",
    UNSUCCESSFUL_REQUEST: "UNSUCCESSFUL_REQUEST"
  });

  // package/library/src/chunks/IFFChunks.js
  var IFFChunk = class {
    /** @param {ByteStream} bs */
    constructor(bs) {
      this.id = bs.readStr4();
      this.length = bs.getInt32();
      this.bs = bs;
    }
    toString() {
      return this.id + " " + this.length + "\n";
    }
  };
  var CompositeChunk = class extends IFFChunk {
    /** @param {ByteStream} bs */
    constructor(bs) {
      super(bs);
      this.id += ":" + bs.readStr4();
    }
    toString(innerString = "") {
      return super.toString() + "    " + innerString.replace(/\n/g, "\n    ") + "\n";
    }
  };
  var ColorChunk = class extends IFFChunk {
    /** @param {ByteStream} bs */
    constructor(bs) {
      super(bs);
      this.header = new ColorChunkDataHeader(bs);
    }
    toString() {
      return this.id + " " + this.length + this.header.toString();
    }
  };
  var INFOChunk = class extends IFFChunk {
    /** @param {ByteStream} bs */
    constructor(bs) {
      super(bs);
      if (this.length < 5) {
        throw new CorruptedFileDjVuError("The INFO chunk is shorter than 5 bytes!");
      }
      this.width = bs.getInt16();
      this.height = bs.getInt16();
      this.minver = bs.getInt8();
      this.majver = this.length > 5 ? bs.getInt8() : 0;
      if (this.length > 7) {
        this.dpi = bs.getUint8();
        this.dpi |= bs.getUint8() << 8;
      } else {
        this.dpi = 300;
      }
      this.gamma = this.length > 8 ? bs.getInt8() : 22;
      this.flags = this.length > 9 ? bs.getInt8() : 0;
      if (this.dpi < 25 || this.dpi > 6e3) {
        this.dpi = 300;
      }
      if (this.gamma < 3) {
        this.gamma = 3;
      }
      if (this.gamma > 50) {
        this.gamma = 50;
      }
    }
    toString() {
      var str = super.toString();
      str += "{width:" + this.width + ", height:" + this.height + ", minver:" + this.minver + ", majver:" + this.majver + ", dpi:" + this.dpi + ", gamma:" + this.gamma + ", flags:" + this.flags + "}\n";
      return str;
    }
  };
  var ColorChunkDataHeader = class {
    /** @param {ByteStream} bs */
    constructor(bs) {
      this.serial = bs.getUint8();
      this.slices = bs.getUint8();
      if (!this.serial) {
        this.majver = bs.getUint8();
        this.grayscale = this.majver >> 7;
        this.minver = bs.getUint8();
        this.width = bs.getUint16();
        this.height = bs.getUint16();
        var byte = bs.getUint8();
        this.delayInit = byte & 127;
        if (!byte & 128) {
          console.warn("Old image reconstruction should be applied!");
        }
      }
    }
    toString() {
      return "\n" + JSON.stringify(this) + "\n";
    }
  };
  var INCLChunk = class extends IFFChunk {
    /** @param {ByteStream} bs */
    constructor(bs) {
      super(bs);
      this.ref = this.bs.readStrUTF();
    }
    toString() {
      var str = super.toString();
      str += "{Reference: " + this.ref + "}\n";
      return str;
    }
  };
  var CIDaChunk = class extends INCLChunk {
  };
  var ErrorChunk = class {
    constructor(id, e) {
      this.id = id;
      this.e = e;
    }
    toString() {
      return `Error creating ${this.id}: ${this.e.toString()}
`;
    }
  };

  // package/library/src/jb2/JB2Codec.js
  var JB2Codec = class extends IFFChunk {
    constructor(bs) {
      super(bs);
      this.zp = new ZPDecoder(this.bs);
      this.directBitmapCtx = new Uint8Array(1024);
      this.refinementBitmapCtx = new Uint8Array(2048);
      this.offsetTypeCtx = [0];
      this.resetNumContexts();
    }
    resetNumContexts() {
      this.recordTypeCtx = new NumContext();
      this.imageSizeCtx = new NumContext();
      this.symbolWidthCtx = new NumContext();
      this.symbolHeightCtx = new NumContext();
      this.inheritDictSizeCtx = new NumContext();
      this.hoffCtx = new NumContext();
      this.voffCtx = new NumContext();
      this.shoffCtx = new NumContext();
      this.svoffCtx = new NumContext();
      this.symbolIndexCtx = new NumContext();
      this.symbolHeightDiffCtx = new NumContext();
      this.symbolWidthDiffCtx = new NumContext();
      this.commentLengthCtx = new NumContext();
      this.commentOctetCtx = new NumContext();
      this.horizontalAbsLocationCtx = new NumContext();
      this.verticalAbsLocationCtx = new NumContext();
    }
    /*decodeNumX(low, high, numctx) { // this is my own implementation
            var v = 0;
            var decision = 0;
            var range = 0xffffffff;
    
            if (low === high) {
                return low;
            }
    
            //phase 1
            decision = (low >= 0) || ((high >= 0) && this.zp.decode(numctx.ctx, 0));
            // раскодировали знак
            var negative = !decision;
            numctx = negative ? numctx.left : numctx.right;
    
            if (negative) { // переводим границы в положительную полуось
                var temp = -low - 1;
                low = -high - 1;
                high = temp;
            }
    
            //phase 2
            decision = (low > (v << 1) + 1) || ((high >= (v << 1) + 1) && this.zp.decode(numctx.ctx, 0));
            while (decision) {
                v += v + 1;
                numctx = numctx.right;
                decision = (low > (v << 1) + 1) || ((high >= (v << 1) + 1) && this.zp.decode(numctx.ctx, 0));
            }
            numctx = numctx.left;
            //phase 3
            range = (v + 1) >> 1;
            while (range) {
                decision = (low > v) || ((high >= (v + range)) && this.zp.decode(numctx.ctx, 0));
                v += decision ? range : 0;
                numctx = decision ? numctx.right : numctx.left;
                range >>= 1;
            }
            //phase 4
            return negative ? (-v - 1) : v;
        }*/
    decodeNum(low, high, numctx) {
      var negative = false;
      var cutoff;
      cutoff = 0;
      for (var phase = 1, range = 4294967295; range != 1; ) {
        var decision = low >= cutoff || high >= cutoff && this.zp.decode(numctx.ctx, 0);
        numctx = decision ? numctx.right : numctx.left;
        switch (phase) {
          case 1:
            negative = !decision;
            if (negative) {
              var temp = -low - 1;
              low = -high - 1;
              high = temp;
            }
            phase = 2;
            cutoff = 1;
            break;
          case 2:
            if (!decision) {
              phase = 3;
              range = (cutoff + 1) / 2;
              if (range == 1)
                cutoff = 0;
              else
                cutoff -= range / 2;
            } else {
              cutoff += cutoff + 1;
            }
            break;
          case 3:
            range /= 2;
            if (range != 1) {
              if (!decision)
                cutoff -= range / 2;
              else
                cutoff += range / 2;
            } else if (!decision) {
              cutoff--;
            }
            break;
        }
      }
      return negative ? -cutoff - 1 : cutoff;
    }
    decodeBitmap(width, height) {
      var bitmap = new Bitmap(width, height);
      for (var i = height - 1; i >= 0; i--) {
        for (var j = 0; j < width; j++) {
          var ind = this.getCtxIndex(bitmap, i, j);
          if (this.zp.decode(this.directBitmapCtx, ind)) {
            bitmap.set(i, j);
          }
          ;
        }
      }
      return bitmap;
    }
    getCtxIndex(bm, i, j) {
      var index = 0;
      var r = i + 2;
      if (bm.hasRow(r)) {
        index = bm.getBits(r, j - 1, 3) << 7;
      }
      r--;
      if (bm.hasRow(r)) {
        index |= bm.getBits(r, j - 2, 5) << 2;
      }
      index |= bm.getBits(i, j - 2, 2);
      return index;
    }
    // don't forget to remove empty edges of the result bitmap before it is added to the dictionary
    decodeBitmapRef(width, height, mbm) {
      var cbm = new Bitmap(width, height);
      var alignInfo = this.alignBitmaps(cbm, mbm);
      for (var i = height - 1; i >= 0; i--) {
        for (var j = 0; j < width; j++) {
          this.zp.decode(
            this.refinementBitmapCtx,
            this.getCtxIndexRef(cbm, mbm, alignInfo, i, j)
          ) ? cbm.set(i, j) : 0;
        }
      }
      return cbm;
    }
    getCtxIndexRef(cbm, mbm, alignInfo, i, j) {
      var index = 0;
      var r = i + 1;
      if (cbm.hasRow(r)) {
        index = cbm.getBits(r, j - 1, 3) << 8;
      }
      index |= cbm.get(i, j - 1) << 7;
      r = i + alignInfo.rowshift + 1;
      var c = j + alignInfo.colshift;
      index |= mbm.hasRow(r) ? mbm.get(r, c) << 6 : 0;
      r--;
      if (mbm.hasRow(r)) {
        index |= mbm.getBits(r, c - 1, 3) << 3;
      }
      r--;
      if (mbm.hasRow(r)) {
        index |= mbm.getBits(r, c - 1, 3);
      }
      return index;
    }
    alignBitmaps(cbm, mbm) {
      var cwidth = cbm.width - 1;
      var cheight = cbm.height - 1;
      var crow, ccol, mrow, mcol;
      crow = cheight >> 1;
      ccol = cwidth >> 1;
      mrow = mbm.height - 1 >> 1;
      mcol = mbm.width - 1 >> 1;
      return {
        "rowshift": mrow - crow,
        "colshift": mcol - ccol
      };
    }
    decodeComment() {
      var length = this.decodeNum(0, 262142, this.commentLengthCtx);
      var comment = new Uint8Array(length);
      for (var i = 0; i < length; comment[i++] = this.decodeNum(0, 255, this.commentOctetCtx)) {
      }
      return comment;
    }
    /**
     * Отладочная функция для просмотра символов.
     * TODO: tranfer it to outside the library
     */
    drawBitmap(bm) {
      var image = document.createElement("canvas").getContext("2d").createImageData(bm.width, bm.height);
      for (var i = 0; i < bm.height; i++) {
        for (var j = 0; j < bm.width; j++) {
          var v = bm.get(i, j) ? 0 : 255;
          var index = ((bm.height - i - 1) * bm.width + j) * 4;
          image.data[index] = v;
          image.data[index + 1] = v;
          image.data[index + 2] = v;
          image.data[index + 3] = 255;
        }
      }
      Globals.drawImage(image);
    }
  };

  // package/library/src/jb2/JB2Dict.js
  var JB2Dict = class extends JB2Codec {
    constructor(bs) {
      super(bs);
      this.dict = [];
      this.isDecoded = false;
    }
    decode(djbz) {
      if (this.isDecoded) {
        return;
      }
      var type = this.decodeNum(0, 11, this.recordTypeCtx);
      if (type == 9) {
        var size = this.decodeNum(0, 262142, this.inheritDictSizeCtx);
        djbz.decode();
        this.dict = djbz.dict.slice(0, size);
        type = this.decodeNum(0, 11, this.recordTypeCtx);
      }
      this.decodeNum(0, 262142, this.imageSizeCtx);
      this.decodeNum(0, 262142, this.imageSizeCtx);
      var flag = this.zp.decode([0], 0);
      if (flag) {
        throw new Error("Bad flag!!!");
      }
      type = this.decodeNum(0, 11, this.recordTypeCtx);
      var width, widthdiff, heightdiff, symbolIndex;
      var height;
      var bm;
      while (type !== 11) {
        switch (type) {
          case 2:
            width = this.decodeNum(0, 262142, this.symbolWidthCtx);
            height = this.decodeNum(0, 262142, this.symbolHeightCtx);
            bm = this.decodeBitmap(width, height);
            this.dict.push(bm);
            break;
          case 5:
            symbolIndex = this.decodeNum(0, this.dict.length - 1, this.symbolIndexCtx);
            widthdiff = this.decodeNum(-262143, 262142, this.symbolWidthDiffCtx);
            heightdiff = this.decodeNum(-262143, 262142, this.symbolHeightDiffCtx);
            var mbm = this.dict[symbolIndex];
            var cbm = this.decodeBitmapRef(mbm.width + widthdiff, heightdiff + mbm.height, mbm);
            this.dict.push(cbm.removeEmptyEdges());
            break;
          case 9:
            console.log("RESET DICT");
            this.resetNumContexts();
            break;
          case 10:
            this.decodeComment();
            break;
          default:
            throw new Error("Unsupported type in JB2Dict: " + type);
        }
        type = this.decodeNum(0, 11, this.recordTypeCtx);
        if (type > 11) {
          console.error("TYPE ERROR " + type);
          break;
        }
      }
      this.isDecoded = true;
    }
  };

  // package/library/src/chunks/DjVuAnno.js
  var DjVuAnno = class extends IFFChunk {
  };

  // package/library/src/chunks/DjViChunk.js
  var DjViChunk = class extends CompositeChunk {
    constructor(bs) {
      super(bs);
      this.innerChunk = null;
      this.init();
    }
    init() {
      while (!this.bs.isEmpty()) {
        var id = this.bs.readStr4();
        var length = this.bs.getInt32();
        this.bs.jump(-8);
        var chunkBs = this.bs.fork(length + 8);
        this.bs.jump(8 + length + (length & 1 ? 1 : 0));
        switch (id) {
          case "Djbz":
            this.innerChunk = new JB2Dict(chunkBs);
            break;
          case "ANTa":
          case "ANTz":
            this.innerChunk = new DjVuAnno(chunkBs);
            break;
          default:
            this.innerChunk = new IFFChunk(chunkBs);
            console.error("Unsupported chunk inside the DJVI chunk: ", id);
            break;
        }
      }
    }
    toString() {
      return super.toString(this.innerChunk.toString());
    }
  };

  // package/library/src/jb2/JB2Image.js
  var JB2Image = class extends JB2Codec {
    constructor(bs) {
      super(bs);
      this.dict = [];
      this.initialDictLength = 0;
      this.blitList = [];
      this.init();
    }
    /**
     * Добавляет в список битмап и координаты левого нижнего угла в классической системе координат
     * @param {Bitmap} bitmap 
     * @param {Number} x 
     * @param {Number} y 
     */
    addBlit(bitmap, x, y) {
      this.blitList.push({ bitmap, x, y });
    }
    //раскодируем первую запись в потоке
    init() {
      var type = this.decodeNum(0, 11, this.recordTypeCtx);
      if (type == 9) {
        this.initialDictLength = this.decodeNum(0, 262142, this.inheritDictSizeCtx);
        type = this.decodeNum(0, 11, this.recordTypeCtx);
      }
      this.width = this.decodeNum(0, 262142, this.imageSizeCtx) || 200;
      this.height = this.decodeNum(0, 262142, this.imageSizeCtx) || 200;
      this.bitmap = false;
      this.lastLeft = 0;
      this.lastBottom = this.height - 1;
      this.firstLeft = -1;
      this.firstBottom = this.height - 1;
      var flag = this.zp.decode([0], 0);
      if (flag) {
        throw new Error("Bad flag!!!");
      }
      this.baseline = new Baseline();
    }
    toString() {
      var str = super.toString();
      str += "{width: " + this.width + ", height: " + this.height + "}\n";
      return str;
    }
    decode(djbz) {
      if (this.initialDictLength) {
        djbz.decode();
        this.dict = djbz.dict.slice(0, this.initialDictLength);
      }
      var type = this.decodeNum(0, 11, this.recordTypeCtx);
      var width, hoff, voff, flag;
      var height, index;
      var bm;
      while (type !== 11) {
        switch (type) {
          case 1:
            width = this.decodeNum(0, 262142, this.symbolWidthCtx);
            height = this.decodeNum(0, 262142, this.symbolHeightCtx);
            bm = this.decodeBitmap(width, height);
            var coords = this.decodeSymbolCoords(bm.width, bm.height);
            this.addBlit(bm, coords.x, coords.y);
            this.dict.push(bm.removeEmptyEdges());
            break;
          case 2:
            width = this.decodeNum(0, 262142, this.symbolWidthCtx);
            height = this.decodeNum(0, 262142, this.symbolHeightCtx);
            bm = this.decodeBitmap(width, height);
            this.dict.push(bm.removeEmptyEdges());
            break;
          case 3:
            width = this.decodeNum(0, 262142, this.symbolWidthCtx);
            height = this.decodeNum(0, 262142, this.symbolHeightCtx);
            bm = this.decodeBitmap(width, height);
            var coords = this.decodeSymbolCoords(bm.width, bm.height);
            this.addBlit(bm, coords.x, coords.y);
            break;
          case 4:
            index = this.decodeNum(0, this.dict.length - 1, this.symbolIndexCtx);
            var widthdiff = this.decodeNum(-262143, 262142, this.symbolWidthDiffCtx);
            var heightdiff = this.decodeNum(-262143, 262142, this.symbolHeightDiffCtx);
            var mbm = this.dict[index];
            var cbm = this.decodeBitmapRef(mbm.width + widthdiff, heightdiff + mbm.height, mbm);
            var coords = this.decodeSymbolCoords(cbm.width, cbm.height);
            this.addBlit(cbm, coords.x, coords.y);
            this.dict.push(cbm.removeEmptyEdges());
            break;
          case 5:
            index = this.decodeNum(0, this.dict.length - 1, this.symbolIndexCtx);
            widthdiff = this.decodeNum(-262143, 262142, this.symbolWidthDiffCtx);
            heightdiff = this.decodeNum(-262143, 262142, this.symbolHeightDiffCtx);
            var mbm = this.dict[index];
            var cbm = this.decodeBitmapRef(mbm.width + widthdiff, heightdiff + mbm.height, mbm);
            this.dict.push(cbm.removeEmptyEdges());
            break;
          case 6:
            index = this.decodeNum(0, this.dict.length - 1, this.symbolIndexCtx);
            var widthdiff = this.decodeNum(-262143, 262142, this.symbolWidthDiffCtx);
            var heightdiff = this.decodeNum(-262143, 262142, this.symbolHeightDiffCtx);
            var mbm = this.dict[index];
            var cbm = this.decodeBitmapRef(mbm.width + widthdiff, heightdiff + mbm.height, mbm);
            var coords = this.decodeSymbolCoords(cbm.width, cbm.height);
            this.addBlit(cbm, coords.x, coords.y);
            break;
          case 7:
            index = this.decodeNum(0, this.dict.length - 1, this.symbolIndexCtx);
            bm = this.dict[index];
            var coords = this.decodeSymbolCoords(bm.width, bm.height);
            this.addBlit(bm, coords.x, coords.y);
            break;
          case 8:
            width = this.decodeNum(0, 262142, this.symbolWidthCtx);
            height = this.decodeNum(0, 262142, this.symbolHeightCtx);
            bm = this.decodeBitmap(width, height);
            var coords = this.decodeAbsoluteLocationCoords(bm.width, bm.height);
            this.addBlit(bm, coords.x, coords.y);
            break;
          case 9:
            console.log("RESET NUM CONTEXTS");
            this.resetNumContexts();
            break;
          case 10:
            this.decodeComment();
            break;
          default:
            throw new Error("Unsupported type in JB2Image: " + type);
        }
        type = this.decodeNum(0, 11, this.recordTypeCtx);
        if (type > 11) {
          console.error("TYPE ERROR " + type);
          break;
        }
      }
    }
    decodeAbsoluteLocationCoords(width, height) {
      var left = this.decodeNum(1, this.width, this.horizontalAbsLocationCtx);
      var top = this.decodeNum(1, this.height, this.verticalAbsLocationCtx);
      return {
        x: left,
        y: top - height
      };
    }
    decodeSymbolCoords(width, height) {
      var flag = this.zp.decode(this.offsetTypeCtx, 0);
      var horizontalOffsetCtx = flag ? this.hoffCtx : this.shoffCtx;
      var verticalOffsetCtx = flag ? this.voffCtx : this.svoffCtx;
      var horizontalOffset = this.decodeNum(-262143, 262142, horizontalOffsetCtx);
      var verticalOffset = this.decodeNum(-262143, 262142, verticalOffsetCtx);
      var x, y;
      if (flag) {
        x = this.firstLeft + horizontalOffset;
        y = this.firstBottom + verticalOffset - height + 1;
        this.firstLeft = x;
        this.firstBottom = y;
        this.baseline.fill(y);
      } else {
        x = this.lastRight + horizontalOffset;
        y = this.baseline.getVal() + verticalOffset;
      }
      this.baseline.add(y);
      this.lastRight = x + width - 1;
      return {
        "x": x,
        // не вычитаем 1, так как firstLeft инициализирован -1, а Baseline и так выдает верный результат
        "y": y
      };
    }
    // принимает битмап и координаты левого нижнего угла в обычной системе координат
    copyToBitmap(bm, x, y) {
      if (!this.bitmap) {
        this.bitmap = new Bitmap(this.width, this.height);
      }
      for (var i = y, k = 0; k < bm.height; k++, i++) {
        for (var j = x, t = 0; t < bm.width; t++, j++) {
          if (bm.get(k, t)) {
            this.bitmap.set(i, j);
          }
        }
      }
    }
    getBitmap() {
      if (!this.bitmap) {
        this.blitList.forEach((blit) => this.copyToBitmap(blit.bitmap, blit.x, blit.y));
      }
      return this.bitmap;
    }
    getMaskImage() {
      var imageData = new ImageData(this.width, this.height);
      var pixelArray = imageData.data;
      var time = performance.now();
      pixelArray.fill(255);
      for (var blitIndex = 0; blitIndex < this.blitList.length; blitIndex++) {
        var blit = this.blitList[blitIndex];
        var bm = blit.bitmap;
        for (var i = blit.y, k = 0; k < bm.height; k++, i++) {
          for (var j = blit.x, t = 0; t < bm.width; t++, j++) {
            if (bm.get(k, t)) {
              var pixelIndex = ((this.height - i - 1) * this.width + j) * 4;
              pixelArray[pixelIndex] = 0;
            }
          }
        }
      }
      DjVu_default.IS_DEBUG && console.log("JB2Image mask image creating time = ", performance.now() - time);
      return imageData;
    }
    /**
     * Создаем изображение из маски и палитры, если таковая имеется
     * @param {DjVuPalette} palette 
     * @param {boolean} isMarkMaskPixels - чтобы понять какой пиксель брать из фона, а какой не трогать. 
     * Нужно только при составлении изображения из двух слоев
     */
    getImage(palette = null, isMarkMaskPixels = false) {
      if (palette && palette.getDataSize() !== this.blitList.length) {
        palette = null;
      }
      var pixelArray = new Uint8ClampedArray(this.width * this.height * 4);
      var time = performance.now();
      pixelArray.fill(255);
      var blackPixel = { r: 0, g: 0, b: 0 };
      var alpha = isMarkMaskPixels ? 0 : 255;
      for (var blitIndex = 0; blitIndex < this.blitList.length; blitIndex++) {
        var blit = this.blitList[blitIndex];
        var pixel = palette ? palette.getPixelByBlitIndex(blitIndex) : blackPixel;
        var bm = blit.bitmap;
        for (var i = blit.y, k = 0; k < bm.height; k++, i++) {
          for (var j = blit.x, t = 0; t < bm.width; t++, j++) {
            if (bm.get(k, t)) {
              var pixelIndex = (this.height - i - 1) * this.width + j << 2;
              pixelArray[pixelIndex] = pixel.r;
              pixelArray[pixelIndex | 1] = pixel.g;
              pixelArray[pixelIndex | 2] = pixel.b;
              pixelArray[pixelIndex | 3] = alpha;
            }
          }
        }
      }
      DjVu_default.IS_DEBUG && console.log("JB2Image creating time = ", performance.now() - time);
      return new ImageData(pixelArray, this.width, this.height);
    }
    getImageFromBitmap() {
      this.getBitmap();
      var time = performance.now();
      var image = new ImageData(this.width, this.height);
      for (var i = 0; i < this.height; i++) {
        for (var j = 0; j < this.width; j++) {
          var v = this.bitmap.get(i, j) ? 0 : 255;
          var index = ((this.height - i - 1) * this.width + j) * 4;
          image.data[index] = v;
          image.data[index + 1] = v;
          image.data[index + 2] = v;
          image.data[index + 3] = 255;
        }
      }
      DjVu_default.IS_DEBUG && console.log("JB2Image creating time = ", performance.now() - time);
      return image;
    }
  };

  // package/library/src/ByteStream.js
  var ByteStream = class _ByteStream {
    constructor(buffer, offsetx, length) {
      this._buffer = buffer;
      this.offsetx = offsetx || 0;
      this.offset = 0;
      this._length = length || buffer.byteLength;
      if (this._length + offsetx > buffer.byteLength) {
        this._length = buffer.byteLength - offsetx;
        console.error("Incorrect length in ByteStream!");
      }
      this.viewer = new DataView(this._buffer, this.offsetx, this._length);
    }
    /** @returns {number} */
    get length() {
      return this._length;
    }
    /** @returns {ArrayBuffer} */
    get buffer() {
      return this._buffer;
    }
    // "читает" следующие length байт в массив, возвращает массив основанный на том же ArrayBuffer
    getUint8Array(length = this.remainingLength()) {
      var off = this.offset;
      this.offset += length;
      return new Uint8Array(this._buffer, this.offsetx + off, length);
    }
    // возвращает массив полностью представляющий весь поток
    toUint8Array() {
      return new Uint8Array(this._buffer, this.offsetx, this._length);
    }
    remainingLength() {
      return this._length - this.offset;
    }
    reset() {
      this.offset = 0;
    }
    byte() {
      if (this.offset >= this._length) {
        this.offset++;
        return 255;
      }
      return this.viewer.getUint8(this.offset++);
    }
    getInt8() {
      return this.viewer.getInt8(this.offset++);
    }
    getInt16() {
      var tmp = this.viewer.getInt16(this.offset);
      this.offset += 2;
      return tmp;
    }
    getUint16() {
      var tmp = this.viewer.getUint16(this.offset);
      this.offset += 2;
      return tmp;
    }
    getInt32() {
      var tmp = this.viewer.getInt32(this.offset);
      this.offset += 4;
      return tmp;
    }
    getUint8() {
      return this.viewer.getUint8(this.offset++);
    }
    getInt24() {
      var uint = this.getUint24();
      return uint & 8388608 ? (16777215 - val + 1) * -1 : uint;
    }
    getUint24() {
      return this.byte() << 16 | this.byte() << 8 | this.byte();
    }
    jump(length) {
      this.offset += length;
      return this;
    }
    setOffset(offset) {
      this.offset = offset;
    }
    readStr4() {
      return String.fromCharCode(...this.getUint8Array(4));
    }
    readStrNT() {
      var array = [];
      var byte = this.getUint8();
      while (byte) {
        array.push(byte);
        byte = this.getUint8();
      }
      return createStringFromUtf8Array(new Uint8Array(array));
    }
    readStrUTF(byteLength) {
      return createStringFromUtf8Array(this.getUint8Array(byteLength));
    }
    fork(length = this.remainingLength()) {
      return new _ByteStream(this._buffer, this.offsetx + this.offset, length);
    }
    clone() {
      return new _ByteStream(this._buffer, this.offsetx, this._length);
    }
    isEmpty() {
      return this.offset >= this._length;
    }
  };

  // package/library/src/bzz/BZZDecoder.js
  var BZZDecoder = class _BZZDecoder {
    constructor(zp) {
      this.zp = zp;
      this.maxblock = 4096;
      this.FREQMAX = 4;
      this.CTXIDS = 3;
      this.ctx = new Uint8Array(300);
      this.size = 0;
      this.blocksize = 0;
      this.data = null;
    }
    decode_raw(bits) {
      var n = 1;
      var m = 1 << bits;
      while (n < m) {
        var b = this.zp.decode();
        n = n << 1 | b;
      }
      return n - m;
    }
    decode_binary(ctxoff, bits) {
      var n = 1;
      var m = 1 << bits;
      ctxoff--;
      while (n < m) {
        var b = this.zp.decode(this.ctx, ctxoff + n);
        n = n << 1 | b;
      }
      return n - m;
    }
    _decode() {
      this.size = this.decode_raw(24);
      if (!this.size) {
        return 0;
      }
      if (this.size > this.maxblock * 1024) {
        throw new Error("Too big block. Error");
      }
      if (this.blocksize < this.size) {
        this.blocksize = this.size;
        this.data = new Uint8Array(this.blocksize);
      } else if (this.data == null) {
        this.data = new Uint8Array(this.blocksize);
      }
      var fshift = 0;
      if (this.zp.decode()) {
        fshift++;
        if (this.zp.decode()) {
          fshift++;
        }
      }
      var mtf = new Uint8Array(256);
      for (var i = 0; i < 256; i++) {
        mtf[i] = i;
      }
      var freq = new Array(this.FREQMAX);
      for (var i = 0; i < this.FREQMAX; freq[i++] = 0) ;
      var fadd = 4;
      var mtfno = 3;
      var markerpos = -1;
      for (var i = 0; i < this.size; i++) {
        var ctxid = this.CTXIDS - 1;
        if (ctxid > mtfno) {
          ctxid = mtfno;
        }
        var ctxoff = 0;
        switch (0) {
          default:
            if (this.zp.decode(this.ctx, ctxoff + ctxid) != 0) {
              mtfno = 0;
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += this.CTXIDS;
            if (this.zp.decode(this.ctx, ctxoff + ctxid) != 0) {
              mtfno = 1;
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += this.CTXIDS;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 2 + this.decode_binary(ctxoff + 1, 1);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 1;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 4 + this.decode_binary(ctxoff + 1, 2);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 3;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 8 + this.decode_binary(ctxoff + 1, 3);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 7;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 16 + this.decode_binary(ctxoff + 1, 4);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 15;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 32 + this.decode_binary(ctxoff + 1, 5);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 31;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 64 + this.decode_binary(ctxoff + 1, 6);
              this.data[i] = mtf[mtfno];
              break;
            }
            ctxoff += 1 + 63;
            if (this.zp.decode(this.ctx, ctxoff + 0) != 0) {
              mtfno = 128 + this.decode_binary(ctxoff + 1, 7);
              this.data[i] = mtf[mtfno];
              break;
            }
            mtfno = 256;
            this.data[i] = 0;
            markerpos = i;
            continue;
        }
        var k;
        fadd = fadd + (fadd >> fshift);
        if (fadd > 268435456) {
          fadd >>= 24;
          freq[0] >>= 24;
          freq[1] >>= 24;
          freq[2] >>= 24;
          freq[3] >>= 24;
          for (k = 4; k < this.FREQMAX; k++) {
            freq[k] >>= 24;
          }
        }
        var fc = fadd;
        if (mtfno < this.FREQMAX) {
          fc += freq[mtfno];
        }
        for (k = mtfno; k >= this.FREQMAX; k--) {
          mtf[k] = mtf[k - 1];
        }
        for (; k > 0 && (4294967295 & fc) >= (4294967295 & freq[k - 1]); k--) {
          mtf[k] = mtf[k - 1];
          freq[k] = freq[k - 1];
        }
        mtf[k] = this.data[i];
        freq[k] = fc;
      }
      if (markerpos < 1 || markerpos >= this.size) {
        throw new Error("BZZ byte stream is corrupted");
      }
      var pos = new Uint32Array(this.size);
      for (var j = 0; j < this.size; pos[j++] = 0) ;
      var count = new Array(256);
      for (var i = 0; i < 256; count[i++] = 0) ;
      for (var i = 0; i < markerpos; i++) {
        var c = this.data[i];
        pos[i] = c << 24 | count[255 & c] & 16777215;
        count[255 & c]++;
      }
      for (var i = markerpos + 1; i < this.size; i++) {
        var c = this.data[i];
        pos[i] = c << 24 | count[255 & c] & 16777215;
        count[255 & c]++;
      }
      var last = 1;
      for (var i = 0; i < 256; i++) {
        var tmp = count[i];
        count[i] = last;
        last += tmp;
      }
      var j = 0;
      last = this.size - 1;
      while (last > 0) {
        var n = pos[j];
        var c = pos[j] >> 24;
        this.data[--last] = 255 & c;
        j = count[255 & c] + (n & 16777215);
      }
      if (j != markerpos) {
        throw new Error("BZZ byte stream is corrupted");
      }
      return this.size;
    }
    /** @return {ByteStream} */
    getByteStream() {
      var bsw, size;
      while (size = this._decode()) {
        if (!bsw) {
          bsw = new ByteStreamWriter(size - 1);
        }
        var arr = new Uint8Array(this.data.buffer, 0, size - 1);
        bsw.writeArray(arr);
      }
      this.data = null;
      return new ByteStream(bsw.getBuffer());
    }
    /**
     * @param {ByteStream} bs
     * @return {ByteStream}
     */
    static decodeByteStream(bs) {
      return new _BZZDecoder(new ZPDecoder(bs)).getByteStream();
    }
  };

  // package/library/src/chunks/DjVuPalette.js
  var DjVuPalette = class extends IFFChunk {
    /** @param {ByteStream} bs */
    constructor(bs) {
      var time = performance.now();
      super(bs);
      this.pixel = { r: 0, g: 0, b: 0 };
      this.version = bs.getUint8();
      if (this.version & 127) {
        throw "Bad Djvu Pallete version!";
      }
      this.palleteSize = bs.getInt16();
      if (this.palleteSize < 0 || this.palleteSize > 65535) {
        throw "Bad Djvu Pallete size!";
      }
      this.colorArray = bs.getUint8Array(this.palleteSize * 3);
      if (this.version & 128) {
        this.dataSize = bs.getInt24();
        if (this.dataSize < 0) {
          throw "Bad Djvu Pallete data size!";
        }
        var bsz = BZZDecoder.decodeByteStream(bs.fork());
        this.colorIndices = new Int16Array(this.dataSize);
        for (var i = 0; i < this.dataSize; i++) {
          var index = bsz.getInt16();
          if (index < 0 || index >= this.palleteSize) {
            throw "Bad Djvu Pallete index! " + index;
          }
          this.colorIndices[i] = index;
        }
      }
      DjVu_default.IS_DEBUG && console.log("DjvuPalette time ", performance.now() - time);
    }
    getDataSize() {
      return this.dataSize;
    }
    getPixelByBlitIndex(index) {
      var colorIndex = this.colorIndices[index] * 3;
      this.pixel.r = this.colorArray[colorIndex + 2];
      this.pixel.g = this.colorArray[colorIndex + 1];
      this.pixel.b = this.colorArray[colorIndex];
      return this.pixel;
    }
    toString() {
      var str = super.toString();
      str += "Pallete size: " + this.palleteSize + "\n";
      str += "Data size: " + this.dataSize + "\n";
      return str;
    }
  };

  // package/library/src/iw44/IWCodecBaseClass.js
  var IWCodecBaseClass = class {
    constructor() {
      this.quant_lo = Uint32Array.of(
        16384,
        32768,
        32768,
        65536,
        65536,
        65536,
        65536,
        65536,
        65536,
        65536,
        65536,
        65536,
        131072,
        131072,
        131072,
        131072
      );
      this.quant_hi = Uint32Array.of(
        0,
        131072,
        131072,
        262144,
        262144,
        262144,
        524288,
        262144,
        262144,
        524288
      );
      this.bucketstate = new Uint8Array(16);
      this.coeffstate = new Array(16);
      var buffer = new ArrayBuffer(256);
      for (var i = 0; i < 16; i++) {
        this.coeffstate[i] = new Uint8Array(buffer, i << 4, 16);
      }
      this.bbstate = 0;
      this.decodeBucketCtx = new Uint8Array(1);
      this.decodeCoefCtx = new Uint8Array(80);
      this.activateCoefCtx = new Uint8Array(16);
      this.inreaseCoefCtx = new Uint8Array(1);
      this.curband = 0;
    }
    getBandBuckets(band) {
      return this.bandBuckets[band];
    }
    //проверяем надо ли вообще что либо делать или просто уменьшить шаг
    is_null_slice() {
      if (this.curband == 0) {
        var is_null = 1;
        for (var i = 0; i < 16; i++) {
          var threshold = this.quant_lo[i];
          this.coeffstate[0][i] = 1;
          if (threshold > 0 && threshold < 32768) {
            this.coeffstate[0][i] = 8;
            is_null = 0;
          }
        }
        return is_null;
      } else {
        var threshold = this.quant_hi[this.curband];
        return !(threshold > 0 && threshold < 32768);
      }
    }
    //уменьшение шага после обработки одной порции данных
    // todo использовать curbit
    finish_code_slice() {
      this.quant_hi[this.curband] = this.quant_hi[this.curband] >> 1;
      if (this.curband === 0) {
        for (var i = 0; i < 16; i++)
          this.quant_lo[i] = this.quant_lo[i] >> 1;
      }
      this.curband++;
      if (this.curband === 10) {
        this.curband = 0;
      }
    }
  };
  IWCodecBaseClass.prototype.ZERO = 1;
  IWCodecBaseClass.prototype.ACTIVE = 2;
  IWCodecBaseClass.prototype.NEW = 4;
  IWCodecBaseClass.prototype.UNK = 8;
  IWCodecBaseClass.prototype.zigzagRow = Uint8Array.of(0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 0, 0, 16, 16, 0, 0, 16, 16, 8, 8, 24, 24, 8, 8, 24, 24, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 4, 4, 20, 20, 4, 4, 20, 20, 12, 12, 28, 28, 12, 12, 28, 28, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 2, 2, 18, 18, 2, 2, 18, 18, 10, 10, 26, 26, 10, 10, 26, 26, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 6, 6, 22, 22, 6, 6, 22, 22, 14, 14, 30, 30, 14, 14, 30, 30, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 1, 1, 17, 17, 1, 1, 17, 17, 9, 9, 25, 25, 9, 9, 25, 25, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 5, 5, 21, 21, 5, 5, 21, 21, 13, 13, 29, 29, 13, 13, 29, 29, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 3, 3, 19, 19, 3, 3, 19, 19, 11, 11, 27, 27, 11, 11, 27, 27, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31, 7, 7, 23, 23, 7, 7, 23, 23, 15, 15, 31, 31, 15, 15, 31, 31);
  IWCodecBaseClass.prototype.zigzagCol = Uint8Array.of(0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 0, 16, 0, 16, 8, 24, 8, 24, 0, 16, 0, 16, 8, 24, 8, 24, 4, 20, 4, 20, 12, 28, 12, 28, 4, 20, 4, 20, 12, 28, 12, 28, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 2, 18, 2, 18, 10, 26, 10, 26, 2, 18, 2, 18, 10, 26, 10, 26, 6, 22, 6, 22, 14, 30, 14, 30, 6, 22, 6, 22, 14, 30, 14, 30, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 1, 17, 1, 17, 9, 25, 9, 25, 1, 17, 1, 17, 9, 25, 9, 25, 5, 21, 5, 21, 13, 29, 13, 29, 5, 21, 5, 21, 13, 29, 13, 29, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31, 3, 19, 3, 19, 11, 27, 11, 27, 3, 19, 3, 19, 11, 27, 11, 27, 7, 23, 7, 23, 15, 31, 15, 31, 7, 23, 7, 23, 15, 31, 15, 31);
  IWCodecBaseClass.prototype.bandBuckets = [
    { from: 0, to: 0 },
    { from: 1, to: 1 },
    { from: 2, to: 2 },
    { from: 3, to: 3 },
    { from: 4, to: 7 },
    { from: 8, to: 11 },
    { from: 12, to: 15 },
    { from: 16, to: 31 },
    { from: 32, to: 47 },
    { from: 48, to: 63 }
  ];

  // package/library/src/iw44/IWStructures.js
  function _normalize(val2) {
    val2 = val2 + 32 >> 6;
    if (val2 < -128) {
      return -128;
    } else if (val2 >= 128) {
      return 127;
    }
    return val2;
  }
  var LazyPixelmap = class {
    constructor(ybytemap, cbbytemap, crbytemap) {
      this.width = ybytemap.width;
      this.yArray = ybytemap.array;
      this.cbArray = cbbytemap ? cbbytemap.array : null;
      this.crArray = crbytemap ? crbytemap.array : null;
      this.writePixel = cbbytemap ? this.writeColoredPixel : this.writeGrayScalePixel;
    }
    writeGrayScalePixel(index, pixelArray, pixelIndex) {
      const value = 127 - _normalize(this.yArray[index]);
      pixelArray[pixelIndex] = value;
      pixelArray[pixelIndex | 1] = value;
      pixelArray[pixelIndex | 2] = value;
    }
    writeColoredPixel(index, pixelArray, pixelIndex) {
      const y = _normalize(this.yArray[index]);
      const b = _normalize(this.cbArray[index]);
      const r = _normalize(this.crArray[index]);
      const t2 = r + (r >> 1);
      const t3 = y + 128 - (b >> 2);
      pixelArray[pixelIndex] = y + 128 + t2;
      pixelArray[pixelIndex | 1] = t3 - (t2 >> 1);
      pixelArray[pixelIndex | 2] = t3 + (b << 1);
    }
  };
  var LinearBytemap = class {
    constructor(width, height) {
      this.width = width;
      this.array = new Int16Array(width * height);
    }
    get(i, j) {
      return this.array[i * this.width + j];
    }
    set(i, j, val2) {
      this.array[i * this.width + j] = val2;
    }
    sub(i, j, val2) {
      this.array[i * this.width + j] -= val2;
    }
    add(i, j, val2) {
      this.array[i * this.width + j] += val2;
    }
  };
  var Bytemap = class extends Array {
    constructor(width, height) {
      super(height);
      this.height = height;
      this.width = width;
      for (var i = 0; i < height; i++) {
        this[i] = new Int16Array(width);
      }
    }
  };
  var Block = class _Block {
    constructor(buffer, offset, withBuckets = false) {
      this.array = new Int16Array(buffer, offset, 1024);
      if (withBuckets) {
        this.buckets = new Array(64);
        for (var i = 0; i < 64; i++) {
          this.buckets[i] = new Int16Array(buffer, offset, 16);
          offset += 32;
        }
      }
    }
    setBucketCoef(bucketNumber, index, value) {
      this.array[bucketNumber << 4 | index] = value;
    }
    getBucketCoef(bucketNumber, index) {
      return this.array[bucketNumber << 4 | index];
    }
    getCoef(n) {
      return this.array[n];
    }
    setCoef(n, val2) {
      this.array[n] = val2;
    }
    /**
     * Функция создания массива блоков на основе одного буфера, более быстрого выделения памяти
     * @returns {Array<Block>}
     */
    static createBlockArray(length) {
      var blocks = new Array(length);
      var buffer = new ArrayBuffer(length << 11);
      for (var i = 0; i < length; i++) {
        blocks[i] = new _Block(buffer, i << 11);
      }
      return blocks;
    }
  };
  var BlockMemoryManager = class {
    constructor() {
      this.buffer = null;
      this.offset = 0;
      this.retainedMemory = 0;
      this.usedMemory = 0;
    }
    ensureBuffer() {
      if (!this.buffer || this.offset >= this.buffer.byteLength) {
        this.buffer = new ArrayBuffer(10 << 20);
        this.offset = 0;
        this.retainedMemory += this.buffer.byteLength;
      }
      return this.buffer;
    }
    allocateBucket() {
      this.ensureBuffer();
      const array = new Int16Array(this.buffer, this.offset, 16);
      this.offset += 32;
      this.usedMemory += 32;
      return array;
    }
  };
  var LazyBlock = class _LazyBlock {
    constructor(memoryManager) {
      this.buckets = new Array(64);
      this.mm = memoryManager;
    }
    setBucketCoef(bucketNumber, index, value) {
      if (!this.buckets[bucketNumber]) {
        this.buckets[bucketNumber] = this.mm.allocateBucket();
      }
      this.buckets[bucketNumber][index] = value;
    }
    getBucketCoef(bucketNumber, index) {
      return this.buckets[bucketNumber] ? this.buckets[bucketNumber][index] : 0;
    }
    getCoef(n) {
      return this.getBucketCoef(n >> 4, n & 15);
    }
    setCoef(n, val2) {
      return this.setBucketCoef(n >> 4, n & 15, val2);
    }
    /**
     * Функция создания массива блоков на основе одного буфера, более быстрого выделения памяти
     * @returns {Array<LazyBlock>}
     */
    static createBlockArray(length) {
      const mm = new BlockMemoryManager();
      const blocks = new Array(length);
      for (var i = 0; i < length; i++) {
        blocks[i] = new _LazyBlock(mm);
      }
      return blocks;
    }
  };

  // package/library/src/iw44/IWDecoder.js
  var IWDecoder = class extends IWCodecBaseClass {
    constructor() {
      super();
    }
    init(imageinfo) {
      this.info = imageinfo;
      var blockCount = Math.ceil(this.info.width / 32) * Math.ceil(this.info.height / 32);
      this.blocks = LazyBlock.createBlockArray(blockCount);
    }
    decodeSlice(zp, imageinfo) {
      if (!this.info) {
        this.init(imageinfo);
      }
      this.zp = zp;
      if (!this.is_null_slice()) {
        this.blocks.forEach((block) => {
          this.preliminaryFlagComputation(block);
          if (this.blockBandDecodingPass()) {
            this.bucketDecodingPass(block, this.curband);
            this.newlyActiveCoefficientDecodingPass(block, this.curband);
          }
          this.previouslyActiveCoefficientDecodingPass(block);
        });
      }
      this.finish_code_slice();
    }
    previouslyActiveCoefficientDecodingPass(block) {
      var boff = 0;
      var step = this.quant_hi[this.curband];
      var indices = this.getBandBuckets(this.curband);
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        for (var j = 0; j < 16; j++) {
          if (this.coeffstate[boff][j] & 2) {
            if (!this.curband) {
              step = this.quant_lo[j];
            }
            var des = 0;
            var coef = block.getBucketCoef(i, j);
            var absCoef = Math.abs(coef);
            if (absCoef <= 3 * step) {
              des = this.zp.decode(this.inreaseCoefCtx, 0);
              absCoef += step >> 2;
            } else {
              des = this.zp.IWdecode();
            }
            if (des) {
              absCoef += step >> 1;
            } else {
              absCoef += -step + (step >> 1);
            }
            block.setBucketCoef(i, j, coef < 0 ? -absCoef : absCoef);
          }
        }
      }
    }
    newlyActiveCoefficientDecodingPass(block, band) {
      var boff = 0;
      var indices = this.getBandBuckets(band);
      var step = this.quant_hi[this.curband];
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        if (this.bucketstate[boff] & 4) {
          var shift = 0;
          if (this.bucketstate[boff] & 2) {
            shift = 8;
          }
          var np = 0;
          for (var j = 0; j < 16; j++) {
            if (this.coeffstate[boff][j] & 8) {
              np++;
            }
          }
          for (var j = 0; j < 16; j++) {
            if (this.coeffstate[boff][j] & 8) {
              var ip = Math.min(7, np);
              var des = this.zp.decode(this.activateCoefCtx, shift + ip);
              if (des) {
                var sign = this.zp.IWdecode() ? -1 : 1;
                np = 0;
                if (!this.curband) {
                  step = this.quant_lo[j];
                }
                block.setBucketCoef(i, j, sign * (step + (step >> 1) - (step >> 3)));
              }
              if (np) {
                np--;
              }
            }
          }
        }
      }
    }
    bucketDecodingPass(block, band) {
      var indices = this.getBandBuckets(band);
      var boff = 0;
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        if (!(this.bucketstate[boff] & 8)) {
          continue;
        }
        var n = 0;
        if (band) {
          var t = 4 * i;
          for (var j = t; j < t + 4; j++) {
            if (block.getCoef(j)) {
              n++;
            }
          }
          if (n === 4) {
            n--;
          }
        }
        if (this.bbstate & 2) {
          n |= 4;
        }
        if (this.zp.decode(this.decodeCoefCtx, n + band * 8)) {
          this.bucketstate[boff] |= 4;
        }
      }
    }
    blockBandDecodingPass() {
      var indices = this.getBandBuckets(this.curband);
      var bcount = indices.to - indices.from + 1;
      if (bcount < 16 || this.bbstate & 2) {
        this.bbstate |= 4;
      } else if (this.bbstate & 8) {
        if (this.zp.decode(this.decodeBucketCtx, 0)) {
          this.bbstate |= 4;
        }
      }
      return this.bbstate & 4;
    }
    preliminaryFlagComputation(block) {
      this.bbstate = 0;
      var bstatetmp = 0;
      var indices = this.getBandBuckets(this.curband);
      if (this.curband) {
        var boff = 0;
        for (var j = indices.from; j <= indices.to; j++, boff++) {
          bstatetmp = 0;
          for (var k = 0; k < 16; k++) {
            if (block.getBucketCoef(j, k) === 0) {
              this.coeffstate[boff][k] = 8;
            } else {
              this.coeffstate[boff][k] = 2;
            }
            bstatetmp |= this.coeffstate[boff][k];
          }
          this.bucketstate[boff] = bstatetmp;
          this.bbstate |= bstatetmp;
        }
      } else {
        for (var k = 0; k < 16; k++) {
          if (this.coeffstate[0][k] !== 1) {
            if (block.getBucketCoef(0, k) === 0) {
              this.coeffstate[0][k] = 8;
            } else {
              this.coeffstate[0][k] = 2;
            }
          }
          bstatetmp |= this.coeffstate[0][k];
        }
        this.bucketstate[0] = bstatetmp;
        this.bbstate |= bstatetmp;
      }
    }
    getBytemap() {
      var time = performance.now();
      var fullWidth = Math.ceil(this.info.width / 32) * 32;
      var fullHeight = Math.ceil(this.info.height / 32) * 32;
      var blockRows = Math.ceil(this.info.height / 32);
      var blockCols = Math.ceil(this.info.width / 32);
      var bm = new LinearBytemap(fullWidth, fullHeight);
      for (var r = 0; r < blockRows; r++) {
        for (var c = 0; c < blockCols; c++) {
          var block = this.blocks[r * blockCols + c];
          for (var i = 0; i < 1024; i++) {
            bm.set(this.zigzagRow[i] + (r << 5), this.zigzagCol[i] + (c << 5), block.getCoef(i));
          }
        }
      }
      DjVu_default.IS_DEBUG && console.time("inverseTime");
      this.inverseWaveletTransform(bm);
      DjVu_default.IS_DEBUG && console.timeEnd("inverseTime");
      DjVu_default.IS_DEBUG && console.log("getBytemap time = ", performance.now() - time);
      return bm;
    }
    /**
     * Алгоритм для строк и для столбцов по сути один и тот же. Разница в том,
     * что индексы переставлены местами.
     * 
     * The variant when the algorithm is extracted as a separate function 
     * and used both for columns with the bytemap object and for rows via a shim object 
     * (which swaps i and j in all methods' of the Bytemap, even 
     * an optimized version working with the inner array directly)
     * works slower than the current variant. 
     */
    inverseWaveletTransform(bitmap) {
      var height = this.info.height;
      var width = this.info.width;
      var a, c, kmax, k, i, border;
      var prev3, prev1, next1, next3;
      for (var s = 16, sDegree = 4; s !== 0; s >>= 1, sDegree--) {
        kmax = height - 1 >> sDegree;
        border = kmax - 3;
        for (i = 0; i < width; i += s) {
          k = 0;
          prev1 = 0;
          next1 = 0;
          next3 = 1 > kmax ? 0 : bitmap.get(1 << sDegree, i);
          for (k = 0; k <= kmax; k += 2) {
            prev3 = prev1;
            prev1 = next1;
            next1 = next3;
            next3 = k + 3 > kmax ? 0 : bitmap.get(k + 3 << sDegree, i);
            a = prev1 + next1;
            c = prev3 + next3;
            bitmap.sub(k << sDegree, i, (a << 3) + a - c + 16 >> 5);
          }
          k = 1;
          prev1 = bitmap.get(k - 1 << sDegree, i);
          if (k + 1 <= kmax) {
            next1 = bitmap.get(k + 1 << sDegree, i);
            bitmap.add(k << sDegree, i, prev1 + next1 + 1 >> 1);
          } else {
            bitmap.add(k << sDegree, i, prev1);
          }
          if (border >= 3) {
            next3 = bitmap.get(k + 3 << sDegree, i);
          }
          for (k = 3; k <= border; k += 2) {
            prev3 = prev1;
            prev1 = next1;
            next1 = next3;
            next3 = bitmap.get(k + 3 << sDegree, i);
            a = prev1 + next1;
            bitmap.add(
              k << sDegree,
              i,
              (a << 3) + a - (prev3 + next3) + 8 >> 4
            );
          }
          for (; k <= kmax; k += 2) {
            prev1 = next1;
            next1 = next3;
            next3 = 0;
            if (k + 1 <= kmax) {
              bitmap.add(k << sDegree, i, prev1 + next1 + 1 >> 1);
            } else {
              bitmap.add(k << sDegree, i, prev1);
            }
          }
        }
        kmax = width - 1 >> sDegree;
        border = kmax - 3;
        for (i = 0; i < height; i += s) {
          k = 0;
          prev1 = 0;
          next1 = 0;
          next3 = 1 > kmax ? 0 : bitmap.get(i, 1 << sDegree);
          for (k = 0; k <= kmax; k += 2) {
            prev3 = prev1;
            prev1 = next1;
            next1 = next3;
            next3 = k + 3 > kmax ? 0 : bitmap.get(i, k + 3 << sDegree);
            a = prev1 + next1;
            c = prev3 + next3;
            bitmap.sub(i, k << sDegree, (a << 3) + a - c + 16 >> 5);
          }
          k = 1;
          prev1 = bitmap.get(i, k - 1 << sDegree);
          if (k + 1 <= kmax) {
            next1 = bitmap.get(i, k + 1 << sDegree);
            bitmap.add(i, k << sDegree, prev1 + next1 + 1 >> 1);
          } else {
            bitmap.add(i, k << sDegree, prev1);
          }
          if (border >= 3) {
            next3 = bitmap.get(i, k + 3 << sDegree);
          }
          for (k = 3; k <= border; k += 2) {
            prev3 = prev1;
            prev1 = next1;
            next1 = next3;
            next3 = bitmap.get(i, k + 3 << sDegree);
            a = prev1 + next1;
            bitmap.add(
              i,
              k << sDegree,
              (a << 3) + a - (prev3 + next3) + 8 >> 4
            );
          }
          for (; k <= kmax; k += 2) {
            prev1 = next1;
            next1 = next3;
            next3 = 0;
            if (k + 1 <= kmax) {
              bitmap.add(i, k << sDegree, prev1 + next1 + 1 >> 1);
            } else {
              bitmap.add(i, k << sDegree, prev1);
            }
          }
        }
      }
    }
  };

  // package/library/src/iw44/IWImage.js
  var IWImage = class {
    constructor() {
      this.info = null;
      this.pixelmap = null;
      this.resetCodecs();
    }
    resetCodecs() {
      this.ycodec = new IWDecoder();
      this.crcodec = this.crcodec ? new IWDecoder() : null;
      this.cbcodec = this.cbcodec ? new IWDecoder() : null;
      this.cslice = 0;
    }
    decodeChunk(zp, header) {
      if (!this.info) {
        this.info = header;
        if (!header.grayscale) {
          this.crcodec = new IWDecoder();
          this.cbcodec = new IWDecoder();
        }
      } else {
        this.info.slices = header.slices;
      }
      for (var i = 0; i < this.info.slices; i++) {
        this.cslice++;
        this.ycodec.decodeSlice(zp, header);
        if (this.crcodec && this.cbcodec && this.cslice > this.info.delayInit) {
          this.cbcodec.decodeSlice(zp, header);
          this.crcodec.decodeSlice(zp, header);
        }
      }
    }
    createPixelmap() {
      var time = performance.now();
      var ybitmap = this.ycodec.getBytemap();
      var cbbitmap = this.cbcodec ? this.cbcodec.getBytemap() : null;
      var crbitmap = this.crcodec ? this.crcodec.getBytemap() : null;
      var pixelMapTime = performance.now();
      this.pixelmap = new LazyPixelmap(ybitmap, cbbitmap, crbitmap);
      DjVu_default.IS_DEBUG && console.log("Pixelmap constructor time = ", performance.now() - pixelMapTime);
      DjVu_default.IS_DEBUG && console.log("IWImage.createPixelmap time = ", performance.now() - time);
      this.resetCodecs();
    }
    /**
     * @returns {ImageData}
     */
    getImage() {
      const time = performance.now();
      if (!this.pixelmap) this.createPixelmap();
      const width = this.info.width;
      const height = this.info.height;
      const image = new ImageData(width, height);
      const processRow = (i) => {
        const rowOffset = i * this.pixelmap.width;
        let pixelIndex = (height - i - 1) * width << 2;
        for (let j = 0; j < width; j++) {
          this.pixelmap.writePixel(rowOffset + j, image.data, pixelIndex);
          image.data[pixelIndex | 3] = 255;
          pixelIndex += 4;
        }
      };
      for (let i = 0; i < height; i++) {
        processRow(i);
      }
      DjVu_default.IS_DEBUG && console.log("IWImage.getImage time = ", performance.now() - time);
      return image;
    }
  };

  // package/library/src/chunks/DjVuText.js
  var DjVuText = class extends IFFChunk {
    constructor(bs) {
      super(bs);
      this.isDecoded = false;
      this.dbs = this.id === "TXTz" ? null : this.bs;
    }
    decode() {
      if (this.isDecoded) {
        return;
      }
      if (!this.dbs) {
        this.dbs = BZZDecoder.decodeByteStream(this.bs);
      }
      this.textLength = this.dbs.getInt24();
      this.utf8array = this.dbs.getUint8Array(this.textLength);
      this.version = this.dbs.getUint8();
      if (this.version !== 1) {
        console.warn("The version in " + this.id + " isn't equal to 1!");
      }
      this.pageZone = this.dbs.isEmpty() ? null : this.decodeZone();
      this.isDecoded = true;
    }
    /** @returns {RawTextZone} */
    decodeZone(parent = null, prev = null) {
      var type = this.dbs.getUint8();
      var x = this.dbs.getUint16() - 32768;
      var y = this.dbs.getUint16() - 32768;
      var width = this.dbs.getUint16() - 32768;
      var height = this.dbs.getUint16() - 32768;
      var textStart = this.dbs.getUint16() - 32768;
      var textLength = this.dbs.getInt24();
      if (prev) {
        if (type === 1 || type === 4 || type === 5) {
          x = x + prev.x;
          y = prev.y - (y + height);
        } else {
          x = x + prev.x + prev.width;
          y = y + prev.y;
        }
        textStart += prev.textStart + prev.textLength;
      } else if (parent) {
        x = x + parent.x;
        y = parent.y + parent.height - (y + height);
        textStart += parent.textStart;
      }
      var zone = { type, x, y, width, height, textStart, textLength };
      var childrenCount = this.dbs.getInt24();
      if (childrenCount) {
        var children = new Array(childrenCount);
        var childZone = null;
        for (var i = 0; i < childrenCount; i++) {
          childZone = this.decodeZone(zone, childZone);
          children[i] = childZone;
        }
        zone.children = children;
      }
      return zone;
    }
    /** @returns {string} */
    getText() {
      this.decode();
      this.text = this.text || createStringFromUtf8Array(this.utf8array);
      return this.text;
    }
    /** @returns {?RawTextZone} */
    getPageZone() {
      this.decode();
      return this.pageZone;
    }
    /** @returns {?Array<TextZone} */
    getNormalizedZones() {
      this.decode();
      if (!this.pageZone) {
        return null;
      }
      if (this.normalizedZones) {
        return this.normalizedZones;
      }
      this.normalizedZones = [];
      var registry = {};
      const process = (zone) => {
        if (zone.children) {
          zone.children.forEach((zone2) => process(zone2));
        } else {
          var key = zone.x.toString() + zone.y + zone.width + zone.height;
          var zoneText = createStringFromUtf8Array(this.utf8array.slice(zone.textStart, zone.textStart + zone.textLength));
          if (registry[key]) {
            registry[key].text += zoneText;
          } else {
            registry[key] = {
              x: zone.x,
              y: zone.y,
              width: zone.width,
              height: zone.height,
              text: zoneText
            };
            this.normalizedZones.push(registry[key]);
          }
        }
      };
      process(this.pageZone);
      return this.normalizedZones;
    }
    toString() {
      this.decode();
      var st = "Text length = " + this.textLength + "\n";
      return super.toString() + st;
    }
  };

  // package/library/src/DjVuPage.js
  var import_browser = __toESM(require_browser());
  var offscreenCanvas = self.OffscreenCanvas ? new OffscreenCanvas(0, 0) : null;
  var ctx = offscreenCanvas ? offscreenCanvas.getContext("2d") : null;
  async function createBlobFromImageData(imageData) {
    if (!offscreenCanvas) {
      return null;
    }
    offscreenCanvas.width = imageData.width;
    offscreenCanvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
    const blob = await offscreenCanvas.convertToBlob();
    offscreenCanvas.width = 0;
    offscreenCanvas.height = 0;
    return blob;
  }
  var DjVuPage = class extends CompositeChunk {
    /**
     * @param {import('./ByteStream').ByteStream} bs
     * @param {Function} getINCLChunkCallback
     */
    constructor(bs, getINCLChunkCallback) {
      super(bs);
      this.getINCLChunkCallback = getINCLChunkCallback;
      this.reset();
    }
    reset() {
      this.bs.setOffset(12);
      this.djbz = null;
      this.bg44arr = new Array();
      this.fg44 = null;
      this.bgimage = null;
      this.fgimage = null;
      this.sjbz = null;
      this.fgbz = null;
      this.text = null;
      this.decoded = false;
      this.isBackgroundCompletelyDecoded = false;
      this.isFirstBgChunkDecoded = false;
      this.info = null;
      this.iffchunks = [];
      this.dependencies = null;
    }
    /**
     * Свойство необходимое для корректного отображения страницы - влияет на 100% масштаб.
     */
    getDpi() {
      if (this.info) {
        return this.info.dpi;
      } else {
        return this.init().info.dpi;
      }
    }
    getHeight() {
      return this.info ? this.info.height : this.init().info.height;
    }
    getWidth() {
      return this.info ? this.info.width : this.init().info.width;
    }
    async createPngObjectUrl() {
      var time = performance.now();
      var imageData = this.getImageData();
      var imageBlob = await createBlobFromImageData(imageData);
      if (!imageBlob) {
        const pngImage = import_browser.default.PNG.sync.write(this.getImageData());
        imageBlob = new Blob([pngImage.buffer]);
      }
      DjVu_default.IS_DEBUG && console.log("Png creation time = ", performance.now() - time);
      var url = URL.createObjectURL(imageBlob);
      return {
        //url: URL.createObjectURL(new Blob([new ArrayBuffer(10 * 1024 * 1024)])),
        url,
        byteLength: imageBlob.size,
        width: this.getWidth(),
        height: this.getHeight(),
        dpi: this.getDpi()
      };
    }
    // метод поиска зависимостей, то есть INCLChunk
    // возвращает массив id
    /** @returns {Array<string>} */
    getDependencies() {
      if (this.info || this.dependencies) {
        return this.dependencies;
      }
      this.dependencies = [];
      var bs = this.bs.fork();
      while (!bs.isEmpty()) {
        var chunk;
        var id = bs.readStr4();
        var length = bs.getInt32();
        bs.jump(-8);
        var chunkBs = bs.fork(length + 8);
        bs.jump(8 + length + (length & 1 ? 1 : 0));
        if (id === "INCL") {
          chunk = new INCLChunk(chunkBs);
          this.dependencies.push(chunk.ref);
        }
      }
      return this.dependencies;
    }
    /**
     * Метод предварительного разбора страницы.
     * Вызывается вручную или автоматически
     * @returns {DjVuPage}
     */
    init() {
      if (this.info) {
        return this;
      }
      this.dependencies = [];
      var id = this.bs.readStr4();
      if (id !== "INFO") {
        throw new CorruptedFileDjVuError("The very first chunk must be INFO chunk, but we got " + id + "!");
      }
      var length = this.bs.getInt32();
      this.bs.jump(-8);
      this.info = new INFOChunk(this.bs.fork(length + 8));
      this.bs.jump(8 + length + (this.info.length & 1));
      this.iffchunks.push(this.info);
      while (!this.bs.isEmpty()) {
        var chunk;
        var id = this.bs.readStr4();
        var length = this.bs.getInt32();
        this.bs.jump(-8);
        var chunkBs = this.bs.fork(length + 8);
        this.bs.jump(8 + length + (length & 1));
        if (!length) {
          chunk = new IFFChunk(chunkBs);
        } else if (id == "FG44") {
          chunk = this.fg44 = new ColorChunk(chunkBs);
        } else if (id == "BG44") {
          this.bg44arr.push(chunk = new ColorChunk(chunkBs));
        } else if (id == "Sjbz") {
          chunk = this.sjbz = new JB2Image(chunkBs);
        } else if (id === "INCL") {
          chunk = this.incl = new INCLChunk(chunkBs);
          var inclChunk = this.getINCLChunkCallback(this.incl.ref);
          if (inclChunk) {
            inclChunk.id === "Djbz" ? this.djbz = inclChunk : this.iffchunks.push(inclChunk);
          }
          this.dependencies.push(chunk.ref);
        } else if (id === "CIDa") {
          try {
            chunk = new CIDaChunk(chunkBs);
          } catch (e) {
            chunk = new ErrorChunk("CIDa", e);
          }
        } else if (id === "Djbz") {
          chunk = this.djbz = new JB2Dict(chunkBs);
        } else if (id === "FGbz") {
          chunk = this.fgbz = new DjVuPalette(chunkBs);
        } else if (id === "TXTa" || id === "TXTz") {
          chunk = this.text = new DjVuText(chunkBs);
        } else {
          chunk = new IFFChunk(chunkBs);
        }
        this.iffchunks.push(chunk);
      }
      return this;
    }
    getRotation() {
      switch (this.info.flags) {
        case 5:
          return 90;
        case 2:
          return 180;
        case 6:
          return 270;
        default:
          return 0;
      }
    }
    rotateIfRequired(imageData) {
      if (this.info.flags === 5 || this.info.flags === 6) {
        var newImageData = new ImageData(this.info.height, this.info.width);
        var newPixelArray = new Uint32Array(newImageData.data.buffer);
        var oldPixelArray = new Uint32Array(imageData.data.buffer);
        var height = this.info.height;
        var width = this.info.width;
        if (this.info.flags === 6) {
          for (var i = 0; i < width; i++) {
            var rowOffset = (width - i - 1) * height;
            var to = height + rowOffset;
            for (var newIndex = rowOffset, oldIndex = i; newIndex < to; newIndex++, oldIndex += width) {
              newPixelArray[newIndex] = oldPixelArray[oldIndex];
            }
          }
        } else {
          for (var i = 0; i < width; i++) {
            var rowOffset = i * height;
            var from = height + rowOffset - 1;
            for (var newIndex = from, oldIndex = i; newIndex >= rowOffset; newIndex--, oldIndex += width) {
              newPixelArray[newIndex] = oldPixelArray[oldIndex];
            }
          }
        }
        return newImageData;
      }
      if (this.info.flags === 2) {
        new Uint32Array(imageData.data.buffer).reverse();
        return imageData;
      }
      return imageData;
    }
    getImageData(rotate = true) {
      const image = this._getImageData();
      const rotatedImage = rotate ? this.rotateIfRequired(image) : image;
      if (image.width * image.height > 1e7) {
        this.reset();
      }
      return rotatedImage;
    }
    /**
     * Метод генерации изображения для общего случая (все 3 слоя) без разворота
     * @returns {ImageData}
     */
    _getImageData() {
      this.decode();
      var time = performance.now();
      if (!this.sjbz) {
        if (this.bgimage) {
          return this.bgimage.getImage();
        } else if (this.fgimage) {
          return this.fgimage.getImage();
        } else {
          var emptyImage = new ImageData(this.info.width, this.info.height);
          emptyImage.data.fill(255);
          return emptyImage;
        }
      }
      if (!this.bgimage && !this.fgimage) {
        return this.sjbz.getImage(this.fgbz);
      }
      var fgscale, bgscale, fgpixelmap, bgpixelmap;
      function fakePixelMap(r, g, b) {
        return {
          writePixel(index, pixelArray, pixelIndex) {
            pixelArray[pixelIndex] = r;
            pixelArray[pixelIndex | 1] = g;
            pixelArray[pixelIndex | 2] = b;
          }
        };
      }
      if (this.bgimage) {
        bgscale = Math.round(this.info.width / this.bgimage.info.width);
        bgpixelmap = this.bgimage.pixelmap;
      } else {
        bgscale = 1;
        bgpixelmap = fakePixelMap(255, 255, 255);
      }
      if (this.fgimage) {
        fgscale = Math.round(this.info.width / this.fgimage.info.width);
        fgpixelmap = this.fgimage.pixelmap;
      } else {
        fgscale = 1;
        fgpixelmap = fakePixelMap(0, 0, 0);
      }
      var image;
      if (!this.fgbz) {
        image = this.createImageFromMaskImageAndPixelMaps(
          this.sjbz.getMaskImage(),
          fgpixelmap,
          bgpixelmap,
          fgscale,
          bgscale
        );
      } else {
        image = this.createImageFromMaskImageAndBackgroundPixelMap(
          this.sjbz.getImage(this.fgbz, true),
          bgpixelmap,
          bgscale
        );
      }
      DjVu_default.IS_DEBUG && console.log("DataImage creating time = ", performance.now() - time);
      return image;
    }
    createImageFromMaskImageAndPixelMaps(maskImage, fgpixelmap, bgpixelmap, fgscale, bgscale) {
      var image = maskImage;
      var pixelArray = image.data;
      var rowIndexOffset = (this.info.height - 1) * this.info.width << 2;
      var width4 = this.info.width << 2;
      for (var i = 0; i < this.info.height; i++) {
        var bis = i / bgscale >> 0;
        var fis = i / fgscale >> 0;
        var bgIndexOffset = bgpixelmap.width * bis;
        var fgIndexOffset = fgpixelmap.width * fis;
        var index = rowIndexOffset;
        for (var j = 0; j < this.info.width; j++) {
          if (pixelArray[index]) {
            bgpixelmap.writePixel(bgIndexOffset + (j / bgscale >> 0), pixelArray, index);
          } else {
            fgpixelmap.writePixel(fgIndexOffset + (j / fgscale >> 0), pixelArray, index);
          }
          index += 4;
        }
        rowIndexOffset -= width4;
      }
      return image;
    }
    createImageFromMaskImageAndBackgroundPixelMap(coloredMaskImage, bgpixelmap, bgscale) {
      var pixelArray = coloredMaskImage.data;
      var rowOffset = (this.info.height - 1) * this.info.width << 2;
      var width4 = this.info.width << 2;
      for (var i = 0; i < this.info.height; i++) {
        var bgRowOffset = (i / bgscale >> 0) * bgpixelmap.width;
        var index = rowOffset;
        for (var j = 0; j < this.info.width; j++) {
          if (pixelArray[index | 3]) {
            bgpixelmap.writePixel(bgRowOffset + (j / bgscale >> 0), pixelArray, index);
          } else {
            pixelArray[index | 3] = 255;
          }
          index += 4;
        }
        rowOffset -= width4;
      }
      return coloredMaskImage;
    }
    decodeForeground() {
      if (this.fg44) {
        this.fgimage = new IWImage();
        var zp = new ZPDecoder(this.fg44.bs);
        this.fgimage.decodeChunk(zp, this.fg44.header);
        var pixelMapTime = performance.now();
        this.fgimage.createPixelmap();
        DjVu_default.IS_DEBUG && console.log("Foreground pixelmap creating time = ", performance.now() - pixelMapTime);
      }
    }
    /**
     * Decoding of the only first chunk was an experimental feature.
     * Now it's not used at all.
     */
    decodeBackground(isOnlyFirstChunk = false) {
      if (this.isBackgroundCompletelyDecoded || this.isFirstBgChunkDecoded && isOnlyFirstChunk) {
        return;
      }
      if (this.bg44arr.length) {
        this.bgimage = this.bgimage || new IWImage();
        var to = isOnlyFirstChunk ? 1 : this.bg44arr.length;
        var from = this.isFirstBgChunkDecoded ? 1 : 0;
        for (var i = from; i < to; i++) {
          var chunk = this.bg44arr[i];
          var zp = new ZPDecoder(chunk.bs);
          var time = performance.now();
          this.bgimage.decodeChunk(zp, chunk.header);
          DjVu_default.IS_DEBUG && console.log("Background chunk decoding time = ", performance.now() - time);
        }
        var pixelMapTime = performance.now();
        this.bgimage.createPixelmap();
        DjVu_default.IS_DEBUG && console.log("Background pixelmap creating time = ", performance.now() - pixelMapTime);
        if (isOnlyFirstChunk) {
          this.isFirstBgChunkDecoded = true;
        } else {
          this.isBackgroundCompletelyDecoded = true;
        }
      }
    }
    /**
     * Раскодирование всех 3 слоев изображения страницы, вызыват init()
     * @returns {DjVuPage}
     */
    decode() {
      if (this.decoded) {
        this.decodeBackground();
        return this;
      }
      this.init();
      var time = performance.now();
      this.sjbz ? this.sjbz.decode(this.djbz) : 0;
      DjVu_default.IS_DEBUG && console.log("Mask decoding time = ", performance.now() - time);
      time = performance.now();
      this.decodeForeground();
      DjVu_default.IS_DEBUG && console.log("Foreground decoding time = ", performance.now() - time);
      time = performance.now();
      this.decodeBackground();
      DjVu_default.IS_DEBUG && console.log("Background decoding time = ", performance.now() - time);
      this.decoded = true;
      return this;
    }
    /**
     * Фоновой слой
     * @returns {ImageData}
     */
    getBackgroundImageData() {
      this.decode();
      if (this.bg44arr.length) {
        this.bg44arr.forEach(
          (chunk) => {
            var zp = new ZPDecoder(chunk.bs);
            this.bgimage.decodeChunk(zp, chunk.header);
          }
        );
        return this.bgimage.getImage();
      } else {
        return null;
      }
    }
    /**
     * @returns {ImageData}
     */
    getForegroundImageData() {
      this.decode();
      if (this.fg44) {
        this.fgimage = new IWImage();
        var zp = new ZPDecoder(this.fg44.bs);
        this.fgimage.decodeChunk(zp, this.fg44.header);
        return this.fgimage.getImage();
      } else {
        return null;
      }
    }
    /** @return {ImageData} */
    getMaskImageData() {
      this.decode();
      return this.sjbz && this.sjbz.getImage(this.fgbz);
    }
    getText() {
      this.init();
      return this.text ? this.text.getText() : "";
    }
    /** @returns {?import('./chunks/DjVuText').RawTextZone} */
    getPageTextZone() {
      this.init();
      return this.text ? this.text.getPageZone() : null;
    }
    /** @returns {?Array<import('./chunks/DjVuText').TextZoneF} */
    getNormalizedTextZones() {
      this.init();
      return this.text ? this.text.getNormalizedZones() : null;
    }
    toString() {
      this.init();
      var str = this.iffchunks.reduce((str2, chunk) => str2 + chunk.toString(), "");
      return super.toString(str);
    }
  };

  // package/library/src/chunks/DirmChunk.js
  var DIRMChunk = class extends IFFChunk {
    constructor(bs) {
      super(bs);
      this.dflags = bs.byte();
      this.isBundled = this.dflags >> 7;
      this.nfiles = bs.getInt16();
      if (this.isBundled) {
        this.offsets = new Int32Array(this.nfiles);
        for (var i = 0; i < this.nfiles; i++) {
          this.offsets[i] = bs.getInt32();
        }
      }
      this.sizes = new Uint32Array(this.nfiles);
      this.flags = new Uint8Array(this.nfiles);
      this.ids = new Array(this.nfiles);
      this.names = new Array(this.nfiles);
      this.titles = new Array(this.nfiles);
      var bsz = BZZDecoder.decodeByteStream(bs.fork());
      for (var i = 0; i < this.nfiles; i++) {
        this.sizes[i] = bsz.getUint24();
      }
      for (var i = 0; i < this.nfiles; i++) {
        this.flags[i] = bsz.byte();
      }
      this.pagesIds = [];
      this.idToNameRegistry = {};
      for (var i = 0; i < this.nfiles && !bsz.isEmpty(); i++) {
        this.ids[i] = bsz.readStrNT();
        this.names[i] = this.flags[i] & 128 ? bsz.readStrNT() : this.ids[i];
        this.titles[i] = this.flags[i] & 64 ? bsz.readStrNT() : this.ids[i];
        if (this.isPageIndex(i)) {
          this.pagesIds.push(this.ids[i]);
        }
        this.idToNameRegistry[this.ids[i]] = this.names[i];
      }
    }
    isPageIndex(i) {
      return (this.flags[i] & 63) === 1;
    }
    isThumbnailIndex(i) {
      return (this.flags[i] & 63) === 2;
    }
    /*isDependencyIndex(i) { // function just for documentation
        return (this.flags[i] & 63) === 0;
    }*/
    getPageNameByItsNumber(number) {
      return this.getComponentNameByItsId(this.pagesIds[number - 1]);
    }
    getPageNumberByItsId(id) {
      const index = this.pagesIds.indexOf(id);
      return index === -1 ? null : index + 1;
    }
    getComponentNameByItsId(id) {
      return this.idToNameRegistry[id];
    }
    getPagesQuantity() {
      return this.pagesIds.length;
    }
    getFilesQuantity() {
      return this.nfiles;
    }
    getMetadataStringByIndex(i) {
      return `[id: "${this.ids[i]}", flag: ${this.flags[i]}, offset: ${this.offsets ? this.offsets[i] : "indirect"}, size: ${this.sizes[i]}]
`;
    }
    toString() {
      var str = super.toString();
      str += (this.isBundled ? "Bundled" : "Indirect") + "\n";
      str += "FilesCount: " + this.nfiles + "\n";
      return str + "\n";
    }
  };

  // package/library/src/chunks/NavmChunk.js
  var NAVMChunk = class extends IFFChunk {
    constructor(bs) {
      super(bs);
      this.isDecoded = false;
      this.contents = [];
      this.decodedBookmarkCounter = 0;
    }
    /**
     * @returns {Contents}
     */
    getContents() {
      this.decode();
      return this.contents;
    }
    decode() {
      if (this.isDecoded) {
        return;
      }
      var dbs = BZZDecoder.decodeByteStream(this.bs);
      var bookmarksCount = dbs.getUint16();
      while (this.decodedBookmarkCounter < bookmarksCount) {
        this.contents.push(this.decodeBookmark(dbs));
      }
      this.isDecoded = true;
    }
    /** 
     * @param {import('../ByteStream').ByteStream} bs
     * @returns {Bookmark}
     */
    decodeBookmark(bs) {
      var childrenCount = bs.getUint8();
      var descriptionLength = bs.getInt24();
      var description = descriptionLength ? bs.readStrUTF(descriptionLength) : "";
      var urlLength = bs.getInt24();
      var url = urlLength ? bs.readStrUTF(urlLength) : "";
      this.decodedBookmarkCounter++;
      var bookmark = { description, url };
      if (childrenCount) {
        var children = new Array(childrenCount);
        for (var i = 0; i < childrenCount; i++) {
          children[i] = this.decodeBookmark(bs);
        }
        bookmark.children = children;
      }
      return bookmark;
    }
    toString() {
      this.decode();
      var indent = "    ";
      function stringifyBookmark(bookmark, indentSize = 0) {
        var str2 = indent.repeat(indentSize) + `${bookmark.description} (${bookmark.url})
`;
        if (bookmark.children) {
          str2 = bookmark.children.reduce((str3, bookmark2) => str3 + stringifyBookmark(bookmark2, indentSize + 1), str2);
        }
        return str2;
      }
      var str = this.contents.reduce((str2, bookmark) => str2 + stringifyBookmark(bookmark), super.toString());
      return str + "\n";
    }
  };

  // package/library/src/bzz/BZZEncoder.js
  var BZZEncoder = class {
    constructor(zp) {
      this.zp = zp || new ZPEncoder();
      this.FREQMAX = 4;
      this.CTXIDS = 3;
      this.ctx = new Uint8Array(300);
      this.size = 0;
      this.blocksize = 0;
      this.FREQS0 = 1e5;
      this.FREQS1 = 1e6;
    }
    // сортировка на основе встроенной функции, может быть не очень оптимальна
    blocksort(arr) {
      var length = arr.length;
      var offs = new Array(arr.length);
      for (var i = 0; i < length; offs[i] = i++) {
      }
      offs.sort((a, b) => {
        for (var i2 = 0; i2 < length; i2++) {
          if (a === this.markerpos) {
            return -1;
          } else if (b === this.markerpos) {
            return 1;
          }
          var res = arr[a % length] - arr[b % length];
          if (res) {
            return res;
          }
          a++;
          b++;
        }
        return 0;
      });
      var narr = new Uint8Array(length);
      for (var i = 0; i < length; i++) {
        var pos = offs[i] - 1;
        if (pos >= 0) {
          narr[i] = arr[pos];
        } else {
          narr[i] = 0;
          this.markerpos = i;
        }
      }
      return narr;
    }
    encode_raw(bits, x) {
      var n = 1;
      var m = 1 << bits;
      while (n < m) {
        x = (x & m - 1) << 1;
        var b = x >> bits;
        this.zp.encode(b);
        n = n << 1 | b;
      }
    }
    encode_binary(cxtoff, bits, x) {
      var n = 1;
      var m = 1 << bits;
      cxtoff--;
      while (n < m) {
        x = (x & m - 1) << 1;
        var b = x >> bits;
        this.zp.encode(b, this.ctx, cxtoff + n);
        n = n << 1 | b;
      }
    }
    encode(buffer) {
      var data = new Uint8Array(buffer);
      var size = data.length;
      var markerpos = size - 1;
      this.markerpos = markerpos;
      data = this.blocksort(data);
      markerpos = this.markerpos;
      this.encode_raw(24, size);
      var fshift = 0;
      if (size < this.FREQS0) {
        fshift = 0;
        this.zp.encode(0);
      } else if (size < this.FREQS1) {
        fshift = 1;
        this.zp.encode(1);
        this.zp.encode(0);
      } else {
        fshift = 2;
        this.zp.encode(1);
        this.zp.encode(1);
      }
      var mtf = new Uint8Array(256);
      var rmtf = new Uint8Array(256);
      var freq = new Uint32Array(this.FREQMAX);
      var m = 0;
      for (m = 0; m < 256; m++)
        mtf[m] = m;
      for (m = 0; m < 256; m++)
        rmtf[mtf[m]] = m;
      var fadd = 4;
      for (m = 0; m < this.FREQMAX; m++)
        freq[m] = 0;
      var i;
      var mtfno = 3;
      for (i = 0; i < size; i++) {
        var c = data[i];
        var ctxid = this.CTXIDS - 1;
        if (ctxid > mtfno)
          ctxid = mtfno;
        mtfno = rmtf[c];
        if (i == markerpos)
          mtfno = 256;
        var b;
        var ctxoff = 0;
        switch (0) {
          default:
            b = mtfno == 0;
            this.zp.encode(b, this.ctx, ctxoff + ctxid);
            if (b)
              break;
            ctxoff += this.CTXIDS;
            b = mtfno == 1;
            this.zp.encode(b, this.ctx, ctxoff + ctxid);
            if (b)
              break;
            ctxoff += this.CTXIDS;
            b = mtfno < 4;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 1, mtfno - 2);
              break;
            }
            ctxoff += 1 + 1;
            b = mtfno < 8;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 2, mtfno - 4);
              break;
            }
            ctxoff += 1 + 3;
            b = mtfno < 16;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 3, mtfno - 8);
              break;
            }
            ctxoff += 1 + 7;
            b = mtfno < 32;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 4, mtfno - 16);
              break;
            }
            ctxoff += 1 + 15;
            b = mtfno < 64;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 5, mtfno - 32);
              break;
            }
            ctxoff += 1 + 31;
            b = mtfno < 128;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 6, mtfno - 64);
              break;
            }
            ctxoff += 1 + 63;
            b = mtfno < 256;
            this.zp.encode(b, this.ctx, ctxoff);
            if (b) {
              this.encode_binary(ctxoff + 1, 7, mtfno - 128);
              break;
            }
            continue;
        }
        fadd = fadd + (fadd >> fshift);
        if (fadd > 268435456) {
          fadd = fadd >> 24;
          freq[0] >>= 24;
          freq[1] >>= 24;
          freq[2] >>= 24;
          freq[3] >>= 24;
          for (var k = 4; k < this.FREQMAX; k++)
            freq[k] = freq[k] >> 24;
        }
        var fc = fadd;
        if (mtfno < this.FREQMAX)
          fc += freq[mtfno];
        var k;
        for (k = mtfno; k >= this.FREQMAX; k--) {
          mtf[k] = mtf[k - 1];
          rmtf[mtf[k]] = k;
        }
        for (; k > 0 && fc >= freq[k - 1]; k--) {
          mtf[k] = mtf[k - 1];
          freq[k] = freq[k - 1];
          rmtf[mtf[k]] = k;
        }
        mtf[k] = c;
        freq[k] = fc;
        rmtf[mtf[k]] = k;
      }
      this.encode_raw(24, 0);
      this.zp.eflush();
      return 0;
    }
  };

  // package/library/src/DjVuWriter.js
  var DjVuWriter = class {
    constructor(length) {
      this.bsw = new ByteStreamWriter(length || 1024 * 1024);
    }
    startDJVM() {
      this.bsw.writeStr("AT&T").writeStr("FORM").saveOffsetMark("fileSize").jump(4).writeStr("DJVM");
    }
    writeDirmChunk(dirm) {
      this.dirm = dirm;
      this.bsw.writeStr("DIRM").saveOffsetMark("DIRMsize").jump(4);
      this.dirm.offsets = [];
      this.bsw.writeByte(dirm.dflags).writeInt16(dirm.flags.length).saveOffsetMark("DIRMoffsets").jump(4 * dirm.flags.length);
      var tmpBS = new ByteStreamWriter();
      for (var i = 0; i < dirm.sizes.length; i++) {
        tmpBS.writeInt24(dirm.sizes[i]);
      }
      for (var i = 0; i < dirm.flags.length; i++) {
        tmpBS.writeByte(dirm.flags[i]);
      }
      for (var i = 0; i < dirm.ids.length; i++) {
        tmpBS.writeStrNT(dirm.ids[i]);
        if (dirm.flags[i] & 128) {
          tmpBS.writeStrNT(dirm.names[i]);
        }
        if (dirm.flags[i] & 64) {
          tmpBS.writeStrNT(dirm.titles[i]);
        }
      }
      tmpBS.writeByte(0);
      var tmpBuffer = tmpBS.getBuffer();
      var bzzBS = new ByteStreamWriter();
      var zp = new ZPEncoder(bzzBS);
      var bzz = new BZZEncoder(zp);
      bzz.encode(tmpBuffer);
      var encodedBuffer = bzzBS.getBuffer();
      this.bsw.writeBuffer(encodedBuffer);
      this.bsw.rewriteSize("DIRMsize");
    }
    get offset() {
      return this.bsw.offset;
    }
    writeByte(byte) {
      this.bsw.writeByte(byte);
      return this;
    }
    writeStr(str) {
      this.bsw.writeStr(str);
      return this;
    }
    writeInt32(val2) {
      this.bsw.writeInt32(val2);
      return this;
    }
    writeFormChunkBS(bs) {
      if (this.bsw.offset & 1) {
        this.bsw.writeByte(0);
      }
      var off = this.bsw.offset;
      this.dirm.offsets.push(off);
      this.bsw.writeByteStream(bs);
    }
    writeFormChunkBuffer(buffer) {
      if (this.bsw.offset & 1) {
        this.bsw.writeByte(0);
      }
      var off = this.bsw.offset;
      this.dirm.offsets.push(off);
      this.bsw.writeBuffer(buffer);
    }
    writeChunk(chunk) {
      if (this.bsw.offset & 1) {
        this.bsw.writeByte(0);
      }
      this.bsw.writeByteStream(chunk.bs);
    }
    /*getByteStream() {
        var bs = new ByteStream(this.buffer);
        return bs;
    }*/
    getBuffer() {
      this.bsw.rewriteSize("fileSize");
      if (this.dirm.offsets.length !== this.dirm.flags.length) {
        throw new Error("\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0435 \u0432\u0441\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0438 \u0441\u043B\u043E\u0432\u0430\u0440\u0438 !!!");
      }
      for (var i = 0; i < this.dirm.offsets.length; i++) {
        this.bsw.rewriteInt32("DIRMoffsets", this.dirm.offsets[i]);
      }
      return this.bsw.getBuffer();
    }
  };

  // package/library/src/chunks/ThumChunk.js
  var ThumChunk = class extends CompositeChunk {
  };

  // package/library/src/methods/load.js
  async function loadByteStream(url, errorData = {}) {
    let xhr;
    try {
      xhr = await loadFileViaXHR(url);
    } catch (e) {
      throw new NetworkDjVuError({ url, ...errorData });
    }
    if (xhr.status && xhr.status !== 200) {
      throw new UnsuccessfulRequestDjVuError(xhr, { ...errorData });
    }
    return new ByteStream(xhr.response);
  }
  function checkAndCropByteStream(bs, compositeChunkId = null, errorData = null) {
    if (bs.readStr4() !== "AT&T") {
      throw new CorruptedFileDjVuError(`The byte stream isn't a djvu file.`, errorData);
    }
    if (!compositeChunkId) {
      return bs.fork();
    }
    let chunkId = bs.readStr4();
    const length = bs.getInt32();
    chunkId += bs.readStr4();
    if (chunkId !== compositeChunkId) {
      throw new CorruptedFileDjVuError(
        `Unexpected chunk id. Expected "${compositeChunkId}", but got "${chunkId}"`,
        errorData
      );
    }
    return bs.jump(-12).fork(length + 8);
  }
  async function loadPage(number, url) {
    const errorData = { pageNumber: number };
    return checkAndCropByteStream(await loadByteStream(url, errorData), null, errorData);
  }
  async function loadPageDependency(id, name, baseUrl, pageNumber = null) {
    const errorData = { pageNumber, dependencyId: id };
    return checkAndCropByteStream(await loadByteStream(baseUrl + name, errorData), "FORMDJVI", errorData);
  }
  async function loadThumbnail(url, id = null) {
    const errorData = { thumbnailId: id };
    return checkAndCropByteStream(await loadByteStream(url, errorData), "FORMTHUM", errorData);
  }

  // package/library/src/methods/bundle.js
  async function bundle(progressCallback = () => {
  }) {
    const djvuWriter = new DjVuWriter();
    djvuWriter.startDJVM();
    const dirm = {
      dflags: this.dirm.dflags | 128,
      flags: [],
      names: [],
      titles: [],
      sizes: [],
      ids: []
    };
    const chunkByteStreams = [];
    const filesQuantity = this.dirm.getFilesQuantity();
    const totalOperations = filesQuantity + 3;
    let pageNumber = 0;
    const limit = pLimit(4);
    let downloadedNumber = 0;
    const promises = [];
    for (let i = 0; i < filesQuantity; i++) {
      promises.push(limit(async () => {
        let bs;
        if (this.dirm.isPageIndex(i)) {
          pageNumber++;
          bs = await loadPage(pageNumber, this._getUrlByPageNumber(pageNumber));
        } else if (this.dirm.isThumbnailIndex(i)) {
          bs = await loadThumbnail(
            this.baseUrl + this.dirm.getComponentNameByItsId(this.dirm.ids[i]),
            this.dirm.ids[i]
          );
        } else {
          bs = await loadPageDependency(
            this.dirm.ids[i],
            this.dirm.getComponentNameByItsId(this.dirm.ids[i]),
            this.baseUrl
          );
        }
        downloadedNumber++;
        progressCallback(downloadedNumber / totalOperations);
        return {
          flags: this.dirm.flags[i],
          id: this.dirm.ids[i],
          name: this.dirm.names[i],
          title: this.dirm.titles[i],
          bs
        };
      }));
    }
    for (const data of await Promise.all(promises)) {
      dirm.flags.push(data.flags);
      dirm.ids.push(data.id);
      dirm.names.push(data.names);
      dirm.titles.push(data.title);
      dirm.sizes.push(data.bs.length);
      chunkByteStreams.push(data.bs);
    }
    djvuWriter.writeDirmChunk(dirm);
    if (this.navm) {
      djvuWriter.writeChunk(this.navm);
    }
    progressCallback((totalOperations - 2) / totalOperations);
    for (let i = 0; i < chunkByteStreams.length; i++) {
      djvuWriter.writeFormChunkBS(chunkByteStreams[i]);
      chunkByteStreams[i] = null;
    }
    progressCallback((totalOperations - 1) / totalOperations);
    const newBuffer = djvuWriter.getBuffer();
    progressCallback(1);
    return new this.constructor(newBuffer);
  }

  // package/library/src/DjVuDocument.js
  var MEMORY_LIMIT = 50 * 1024 * 1024;
  var DjVuDocument = class _DjVuDocument {
    constructor(arraybuffer, { baseUrl = null, memoryLimit = MEMORY_LIMIT } = {}) {
      this.buffer = arraybuffer;
      this.baseUrl = baseUrl && baseUrl.trim();
      if (typeof this.baseUrl === "string") {
        if (this.baseUrl[this.baseUrl.length - 1] !== "/") {
          this.baseUrl += "/";
        }
        if (!/^[A-Za-z]+:\/\//.test(this.baseUrl)) {
          this.baseUrl = location.origin && new URL(this.baseUrl, location.origin).href;
        }
      }
      this.memoryLimit = memoryLimit;
      this.djvi = {};
      this.getINCLChunkCallback = (id) => this.djvi[id].innerChunk;
      this.bs = new ByteStream(arraybuffer);
      this.formatID = this.bs.readStr4();
      if (this.formatID !== "AT&T") {
        throw new IncorrectFileFormatDjVuError();
      }
      this.id = this.bs.readStr4();
      this.length = this.bs.getInt32();
      this.id += this.bs.readStr4();
      if (this.id === "FORMDJVM") {
        this._initMultiPageDocument();
      } else if (this.id === "FORMDJVU") {
        this.bs.jump(-12);
        this.pages = [new DjVuPage(this.bs.fork(this.length + 8), this.getINCLChunkCallback)];
      } else {
        throw new CorruptedFileDjVuError(
          `The id of the first chunk of the document should be either FORMDJVM or FORMDJVU, but there is ${this.id}`
        );
      }
    }
    _initMultiPageDocument() {
      this._readMetaDataChunk();
      this._readContentsChunkIfExists();
      this.pages = [];
      this.thumbs = [];
      if (this.dirm.isBundled) {
        this._parseComponents();
      } else {
        this.pages = new Array(this.dirm.getPagesQuantity());
        this.memoryUsage = this.bs.buffer.byteLength;
        this.loadedPageNumbers = [];
      }
    }
    _readMetaDataChunk() {
      var id = this.bs.readStr4();
      if (id !== "DIRM") {
        throw new CorruptedFileDjVuError("The DIRM chunk must be the first but there is " + id + " instead!");
      }
      var length = this.bs.getInt32();
      this.bs.jump(-8);
      this.dirm = new DIRMChunk(this.bs.fork(length + 8));
      this.bs.jump(8 + length + (length & 1 ? 1 : 0));
    }
    _readContentsChunkIfExists() {
      this.navm = null;
      if (this.bs.remainingLength() > 8) {
        var id = this.bs.readStr4();
        var length = this.bs.getInt32();
        this.bs.jump(-8);
        if (id === "NAVM") {
          this.navm = new NAVMChunk(this.bs.fork(length + 8));
        }
      }
    }
    _parseComponents() {
      this.dirmOrderedChunks = new Array(this.dirm.getFilesQuantity());
      for (var i = 0; i < this.dirm.offsets.length; i++) {
        this.bs.setOffset(this.dirm.offsets[i]);
        var id = this.bs.readStr4();
        var length = this.bs.getInt32();
        id += this.bs.readStr4();
        this.bs.jump(-12);
        switch (id) {
          case "FORMDJVU":
            this.pages.push(this.dirmOrderedChunks[i] = new DjVuPage(
              this.bs.fork(length + 8),
              this.getINCLChunkCallback
            ));
            break;
          case "FORMDJVI":
            this.dirmOrderedChunks[i] = this.djvi[this.dirm.ids[i]] = new DjViChunk(this.bs.fork(length + 8));
            break;
          case "FORMTHUM":
            this.thumbs.push(this.dirmOrderedChunks[i] = new ThumChunk(this.bs.fork(length + 8)));
            break;
          default:
            console.error("Incorrect chunk ID: ", id);
        }
      }
    }
    /**
     * @returns {Array<{ width: number, height: number, dpi: number }>} 
     */
    getPagesSizes() {
      var sizes = this.pages.map((page) => {
        return {
          width: page.getWidth(),
          height: page.getHeight(),
          dpi: page.getDpi()
        };
      });
      this.pages.forEach((page) => page.reset());
      return sizes;
    }
    isBundled() {
      return this.dirm ? this.dirm.isBundled : true;
    }
    getPagesQuantity() {
      return this.dirm ? this.dirm.getPagesQuantity() : 1;
    }
    /** @returns {import('./chunks/NavmChunk').Contents} */
    getContents() {
      return this.navm ? this.navm.getContents() : null;
    }
    getMemoryUsage() {
      return this.memoryUsage;
    }
    getMemoryLimit() {
      return this.memoryLimit;
    }
    setMemoryLimit(limit = MEMORY_LIMIT) {
      this.memoryLimit = limit;
    }
    getPageNumberByUrl(url) {
      if (url[0] !== "#") {
        return null;
      }
      const ref = url.slice(1);
      let pageNumber = this.dirm.getPageNumberByItsId(ref);
      if (!pageNumber) {
        const num = Math.round(Number(ref));
        if (num >= 1 && num <= this.pages.length) {
          pageNumber = num;
        }
      }
      return pageNumber || null;
    }
    releaseMemoryIfRequired(preservedDependencies = null) {
      if (this.memoryUsage <= this.memoryLimit) {
        return;
      }
      while (this.memoryUsage > this.memoryLimit && this.loadedPageNumbers.length) {
        var number = this.loadedPageNumbers.shift();
        this.memoryUsage -= this.pages[number].bs.buffer.byteLength;
        this.pages[number] = null;
      }
      if (this.memoryUsage > this.memoryLimit && !this.loadedPageNumbers.length) {
        this.resetLastRequestedPage();
        var newDjVi = {};
        if (preservedDependencies) {
          preservedDependencies.forEach((id) => {
            newDjVi[id] = this.djvi[id];
            this.memoryUsage += newDjVi[id].bs.buffer.byteLength;
          });
        }
        Object.keys(this.djvi).forEach((key) => {
          this.memoryUsage -= this.djvi[key].bs.buffer.byteLength;
        });
        this.djvi = newDjVi;
      }
    }
    _getUrlByPageNumber(number) {
      return this.baseUrl + this.dirm.getPageNameByItsNumber(number);
    }
    async getPage(number) {
      var page = this.pages[number - 1];
      if (this.lastRequestedPage && this.lastRequestedPage !== page) {
        this.lastRequestedPage.reset();
      }
      this.lastRequestedPage = page;
      if (!page) {
        if (number < 1 || number > this.pages.length || this.isBundled()) {
          throw new NoSuchPageDjVuError(number);
        } else {
          if (this.baseUrl === null) {
            throw new NoBaseUrlDjVuError();
          }
          const bs = await loadPage(
            number,
            this._getUrlByPageNumber(number)
          );
          const page2 = new DjVuPage(bs, this.getINCLChunkCallback);
          this.memoryUsage += bs.buffer.byteLength;
          await this._loadDependencies(page2.getDependencies(), number);
          this.releaseMemoryIfRequired(page2.getDependencies());
          this.pages[number - 1] = page2;
          this.loadedPageNumbers.push(number - 1);
          this.lastRequestedPage = page2;
        }
      } else if (!this.isOnePageDependenciesLoaded && this.id === "FORMDJVU") {
        var dependencies = page.getDependencies();
        if (dependencies.length) {
          await this._loadDependencies(dependencies, 1);
        }
        this.isOnePageDependenciesLoaded = true;
      }
      return this.lastRequestedPage;
    }
    async _loadDependencies(dependencies, pageNumber = null) {
      var unloadedDependencies = dependencies.filter((id) => !this.djvi[id]);
      if (!unloadedDependencies.length) {
        return;
      }
      await Promise.all(unloadedDependencies.map(async (id) => {
        const bs = await loadPageDependency(
          id,
          this.dirm ? this.dirm.getComponentNameByItsId(id) : id,
          this.baseUrl,
          pageNumber
        );
        this.djvi[id] = new DjViChunk(bs);
        this.memoryUsage += bs.buffer.byteLength;
      }));
    }
    getPageUnsafe(number) {
      return this.pages[number - 1];
    }
    resetLastRequestedPage() {
      this.lastRequestedPage && this.lastRequestedPage.reset();
      this.lastRequestedPage = null;
    }
    /** A debug function, isn't actually used */
    countFiles() {
      var count = 0;
      var bs = this.bs.clone();
      bs.jump(16);
      while (!bs.isEmpty()) {
        var id = bs.readStr4();
        var length = bs.getInt32();
        bs.jump(length + (length & 1 ? 1 : 0));
        if (id === "FORM") {
          count++;
        }
      }
      return count;
    }
    /**
     * Возвращает метаданные документа. 
     * @param {Boolean} html - заменять ли \n на <br>
     * @returns {string} строка метаданных
     */
    toString(html) {
      var str = this.formatID + "\n";
      if (this.dirm) {
        str += this.id + " " + this.length + "\n\n";
        str += this.dirm.toString();
        str += this.navm ? this.navm.toString() : "";
        if (this.isBundled()) {
          this.dirmOrderedChunks.forEach((chunk, i) => {
            str += this.dirm.getMetadataStringByIndex(i) + chunk.toString();
          });
        } else {
          for (let i = 0; i < this.dirm.getFilesQuantity(); i++) {
            str += this.dirm.getMetadataStringByIndex(i);
          }
        }
      } else {
        str += this.pages[0].toString();
      }
      return html ? str.replace(/\n/g, "<br>").replace(/\s/g, "&nbsp;") : str;
    }
    /**
     * Создает ссылку для скачивания документа
     */
    createObjectURL() {
      var blob = new Blob([this.bs.buffer]);
      var url = URL.createObjectURL(blob);
      return url;
    }
    /**
     *  Creates a new DjVuDocument with pages from "from" to "to", including first and last pages.
     */
    slice(from = 1, to = this.pages.length) {
      const djvuWriter = new DjVuWriter();
      djvuWriter.startDJVM();
      const dirm = {
        dflags: this.dirm.dflags,
        flags: [],
        names: [],
        titles: [],
        sizes: [],
        ids: []
      };
      const chunkByteStreams = [];
      const totalPageCount = to - from + 1;
      const dependencies = {};
      const filesQuantity = this.dirm.getFilesQuantity();
      for (let i = 0, pageIndex = 0, addedPageCount = 0; i < filesQuantity && addedPageCount < totalPageCount; i++) {
        const isPage = (this.dirm.flags[i] & 63) === 1;
        if (!isPage) continue;
        pageIndex++;
        if (pageIndex < from) continue;
        addedPageCount++;
        const pageByteStream = new ByteStream(this.buffer, this.dirm.offsets[i], this.dirm.sizes[i]);
        const deps = new DjVuPage(pageByteStream).getDependencies();
        for (const dependencyId of deps) {
          dependencies[dependencyId] = 1;
        }
      }
      for (
        let i = 0, pageIndex = 0, addedPageCount = 0;
        // ?? maybe dicts can go after pages and we should check all chunks (remove addedPageCount < totalPageCount)
        i < filesQuantity && addedPageCount < totalPageCount;
        i++
      ) {
        const isPage = (this.dirm.flags[i] & 63) === 1;
        if (isPage) {
          pageIndex++;
          if (pageIndex < from) continue;
          addedPageCount++;
        }
        if (this.dirm.ids[i] in dependencies || isPage) {
          dirm.flags.push(this.dirm.flags[i]);
          dirm.sizes.push(this.dirm.sizes[i]);
          dirm.ids.push(this.dirm.ids[i]);
          dirm.names.push(this.dirm.names[i]);
          dirm.titles.push(this.dirm.titles[i]);
          chunkByteStreams.push(
            new ByteStream(this.buffer, this.dirm.offsets[i], this.dirm.sizes[i])
          );
        }
      }
      djvuWriter.writeDirmChunk(dirm);
      if (this.navm) {
        djvuWriter.writeChunk(this.navm);
      }
      for (const chunkByteStream of chunkByteStreams) {
        djvuWriter.writeFormChunkBS(chunkByteStream);
      }
      const newBuffer = djvuWriter.getBuffer();
      DjVu_default.IS_DEBUG && console.log("New Buffer size = ", newBuffer.byteLength);
      return new _DjVuDocument(newBuffer);
    }
    /**
     * Функция склейки двух документов
     */
    static concat(doc1, doc2) {
      var dirm = {};
      var length = doc1.pages.length + doc2.pages.length;
      dirm.dflags = 129;
      dirm.flags = [];
      dirm.sizes = [];
      dirm.ids = [];
      var pages = [];
      var idset = /* @__PURE__ */ new Set();
      if (!doc1.dirm) {
        dirm.flags.push(1);
        dirm.sizes.push(doc1.pages[0].bs.length);
        dirm.ids.push("single");
        idset.add("single");
        pages.push(doc1.pages[0]);
      } else {
        for (var i = 0; i < doc1.pages.length; i++) {
          dirm.flags.push(doc1.dirm.flags[i]);
          dirm.sizes.push(doc1.dirm.sizes[i]);
          dirm.ids.push(doc1.dirm.ids[i]);
          idset.add(doc1.dirm.ids[i]);
          pages.push(doc1.pages[i]);
        }
      }
      if (!doc2.dirm) {
        dirm.flags.push(1);
        dirm.sizes.push(doc2.pages[0].bs.length);
        var newid = "single2";
        var tmp = 0;
        while (idset.has(newid)) {
          newid = "single2" + tmp.toString();
          tmp++;
        }
        dirm.ids.push(newid);
        pages.push(doc2.pages[0]);
      } else {
        for (var i = 0; i < doc2.pages.length; i++) {
          dirm.flags.push(doc2.dirm.flags[i]);
          dirm.sizes.push(doc2.dirm.sizes[i]);
          var newid = doc2.dirm.ids[i];
          var tmp = 0;
          while (idset.has(newid)) {
            newid = doc2.dirm.ids[i] + tmp.toString();
            tmp++;
          }
          dirm.ids.push(newid);
          idset.add(newid);
          pages.push(doc2.pages[i]);
        }
      }
      var dw = new DjVuWriter();
      dw.startDJVM();
      dw.writeDirmChunk(dirm);
      for (var i = 0; i < length; i++) {
        dw.writeFormChunkBS(pages[i].bs);
      }
      return new _DjVuDocument(dw.getBuffer());
    }
  };
  Object.assign(DjVuDocument.prototype, {
    bundle
  });

  // package/library/src/DjVuWorker.js
  function getLinkToTheWholeLibrary() {
    if (!getLinkToTheWholeLibrary.url) {
      getLinkToTheWholeLibrary.url = URL.createObjectURL(new Blob(
        ["(" + DjVuScript.toString() + ")();"],
        { type: "application/javascript" }
      ));
    }
    return getLinkToTheWholeLibrary.url;
  }
  var DjVuWorker = class {
    constructor(path = getLinkToTheWholeLibrary()) {
      this.path = path;
      this.reset();
    }
    reset() {
      this.terminate();
      this.worker = new Worker(this.path);
      this.worker.onmessage = (e) => this.messageHandler(e);
      this.worker.onerror = (e) => this.errorHandler(e);
      this.promiseCallbacks = null;
      this.currentPromise = null;
      this.promiseMap = /* @__PURE__ */ new Map();
      this.isWorking = false;
      this.commandCounter = 0;
      this.currentCommandId = null;
      this.hyperCallbacks = {};
      this.hyperCallbackCounter = 0;
    }
    registerHyperCallback(func) {
      const id = this.hyperCallbackCounter++;
      this.hyperCallbacks[id] = func;
      return { hyperCallback: true, id };
    }
    unregisterHyperCallback(id) {
      delete this.hyperCallbacks[id];
    }
    terminate() {
      this.worker && this.worker.terminate();
    }
    get doc() {
      return DjVuWorkerTask.instance(this);
    }
    errorHandler(event) {
      console.error("DjVu.js Worker error!", event);
    }
    cancelTask(promise) {
      if (!this.promiseMap.delete(promise)) {
        if (this.currentPromise === promise) {
          this.dropCurrentTask();
        }
      }
    }
    dropCurrentTask() {
      this.currentPromise = null;
      this.promiseCallbacks = null;
      this.currentCommandId = null;
    }
    emptyTaskQueue() {
      this.promiseMap.clear();
    }
    cancelAllTasks() {
      this.emptyTaskQueue();
      this.dropCurrentTask();
    }
    /**
     * @param {CommandObject} commandObj
     * @param {Array<Transferable>} transferList
     */
    createNewPromise(commandObj, transferList = void 0) {
      var callbacks;
      var promise = new Promise((resolve, reject) => {
        callbacks = { resolve, reject };
      });
      this.promiseMap.set(promise, { callbacks, commandObj, transferList });
      this.runNextTask();
      return promise;
    }
    /**
     * Replaces functions with special "hyper callback" objects - it allows invoking callbacks from the web worker
     * (asynchronously of course, but it's mostly used to track progress)
     * @param {CommandObject} commandObj
     * @returns {CommandObject}
     */
    prepareCommandObject(commandObj) {
      if (!(commandObj.data instanceof Array)) return commandObj;
      const hyperCallbackIds = [];
      for (const { args: argsList } of commandObj.data) {
        for (const args of argsList) {
          for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === "function") {
              const hyperCallback = this.registerHyperCallback(args[i]);
              args[i] = hyperCallback;
              hyperCallbackIds.push(hyperCallback.id);
            }
          }
        }
      }
      if (hyperCallbackIds.length) {
        commandObj.sendBackData = {
          ...commandObj.sendBackData,
          hyperCallbackIds
        };
      }
      return commandObj;
    }
    runNextTask() {
      if (this.isWorking) {
        return;
      }
      var next = this.promiseMap.entries().next().value;
      if (next) {
        const [promise, { callbacks, commandObj, transferList }] = next;
        this.promiseCallbacks = callbacks;
        this.currentPromise = promise;
        this.currentCommandId = this.commandCounter++;
        commandObj.sendBackData = {
          commandId: this.currentCommandId
        };
        this.worker.postMessage(this.prepareCommandObject(commandObj), transferList);
        this.isWorking = true;
        this.promiseMap.delete(promise);
      } else {
        this.dropCurrentTask();
      }
    }
    isTaskInProcess(promise) {
      return this.currentPromise === promise;
    }
    isTaskInQueue(promise) {
      return this.promiseMap.has(promise) || this.isTaskInProcess(promise);
    }
    processAction(obj) {
      switch (obj.action) {
        case "Process":
          this.onprocess ? this.onprocess(obj.percent) : 0;
          break;
        case "hyperCallback":
          if (this.hyperCallbacks[obj.id]) this.hyperCallbacks[obj.id](...obj.args);
          break;
      }
    }
    messageHandler({ data: obj }) {
      if (obj.action) return this.processAction(obj);
      this.isWorking = false;
      const callbacks = this.promiseCallbacks;
      const commandId = obj.sendBackData && obj.sendBackData.commandId;
      if (commandId === this.currentCommandId || this.currentCommandId === null) {
        this.runNextTask();
      } else {
        if (obj === "unhandledrejection" || obj === "error") {
          console.warn("DjVu.js: " + obj + " occurred in the worker!");
          this.runNextTask();
        } else {
          console.warn("DjVu.js: Something strange came from the worker.", obj);
        }
        return;
      }
      if (!callbacks) return;
      const { resolve, reject } = callbacks;
      switch (obj.command) {
        case "Error":
          reject(obj.error);
          break;
        case "createDocument":
        case "startMultiPageDocument":
        case "addPageToDocument":
          resolve();
          break;
        case "createDocumentFromPictures":
        case "endMultiPageDocument":
          resolve(obj.buffer);
          break;
        case "run":
          var restoredResult = !obj.result ? obj.result : obj.result.length && obj.result.map ? obj.result.map((result) => this.restoreValueAfterTransfer(result)) : this.restoreValueAfterTransfer(obj.result);
          resolve(restoredResult);
          break;
        default:
          console.error("Unexpected message from DjVuWorker: ", obj);
      }
      if (obj.sendBackData && obj.sendBackData.hyperCallbackIds) {
        obj.sendBackData.hyperCallbackIds.forEach((id) => this.unregisterHyperCallback(id));
      }
    }
    restoreValueAfterTransfer(value) {
      if (value) {
        if (value.width && value.height && value.buffer) {
          return new ImageData(new Uint8ClampedArray(value.buffer), value.width, value.height);
        }
      }
      return value;
    }
    /** @param {DjVuWorkerTask} tasks */
    run(...tasks) {
      const data = tasks.map((task) => task._);
      return this.createNewPromise({
        command: "run",
        data
        //time: Date.now(),
      });
    }
    revokeObjectURL(url) {
      this.worker.postMessage({
        action: this.revokeObjectURL.name,
        url
      });
    }
    startMultiPageDocument(slicenumber, delayInit, grayscale) {
      return this.createNewPromise({
        command: "startMultiPageDocument",
        slicenumber,
        delayInit,
        grayscale
      });
    }
    addPageToDocument(imageData) {
      var simpleImage = {
        buffer: imageData.data.buffer,
        width: imageData.width,
        height: imageData.height
      };
      return this.createNewPromise({
        command: "addPageToDocument",
        simpleImage
      }, [simpleImage.buffer]);
    }
    endMultiPageDocument() {
      return this.createNewPromise({ command: "endMultiPageDocument" });
    }
    createDocument(buffer, options) {
      return this.createNewPromise({ command: "createDocument", buffer, options }, [buffer]);
    }
    createDocumentFromPictures(imageArray, slicenumber, delayInit, grayscale) {
      var simpleImages = new Array(imageArray.length);
      var buffers = new Array(imageArray.length);
      for (var i = 0; i < imageArray.length; i++) {
        simpleImages[i] = {
          buffer: imageArray[i].data.buffer,
          width: imageArray[i].width,
          height: imageArray[i].height
        };
        buffers[i] = imageArray[i].data.buffer;
      }
      return this.createNewPromise({
        command: "createDocumentFromPictures",
        images: simpleImages,
        slicenumber,
        delayInit,
        grayscale
      }, buffers);
    }
  };
  var DjVuWorkerTask = class _DjVuWorkerTask {
    /**
     * @property {{funcs: string[], args: any[][]}} _
     */
    /**
     * @param {DjVuWorker} worker
     * @param {string[]} funcs
     * @param {any[][]} args
     */
    static instance(worker, funcs = [], args = []) {
      var proxy = new Proxy(_DjVuWorkerTask.emptyFunc, {
        get: (target, key) => {
          switch (key) {
            case "_":
              return { funcs, args };
            case "run":
              return () => worker.run(proxy);
            default:
              return _DjVuWorkerTask.instance(worker, [...funcs, key], args);
          }
        },
        apply: (target, that, _args) => {
          return _DjVuWorkerTask.instance(worker, funcs, [...args, _args]);
        }
      });
      return proxy;
    }
    static emptyFunc() {
    }
  };

  // package/library/src/iw44/IWEncoder.js
  var IWEncoder = class extends IWCodecBaseClass {
    constructor(bytemap) {
      super();
      this.width = bytemap.width;
      this.height = bytemap.height;
      this.inverseWaveletTransform(bytemap);
      this.createBlocks(bytemap);
    }
    /**
     * Выполняет волновое преобразование
     */
    inverseWaveletTransform(bytemap) {
      for (var scale = 1; scale < 32; scale <<= 1) {
        this.filter_fh(scale, bytemap);
        this.filter_fv(scale, bytemap);
      }
      return bytemap;
    }
    // по сути то же преобразование что и при раскодировании, только в обратном порядке
    filter_fv(s, bitmap) {
      var kmax = Math.floor((bitmap.height - 1) / s);
      for (var i = 0; i < bitmap.width; i += s) {
        for (var k = 1; k <= kmax; k += 2) {
          if (k - 3 >= 0 && k + 3 <= kmax) {
            bitmap[k * s][i] -= 9 * (bitmap[(k - 1) * s][i] + bitmap[(k + 1) * s][i]) - (bitmap[(k - 3) * s][i] + bitmap[(k + 3) * s][i]) + 8 >> 4;
          } else if (k + 1 <= kmax) {
            bitmap[k * s][i] -= bitmap[(k - 1) * s][i] + bitmap[(k + 1) * s][i] + 1 >> 1;
          } else {
            bitmap[k * s][i] -= bitmap[(k - 1) * s][i];
          }
        }
        for (var k = 0; k <= kmax; k += 2) {
          var a, b, c, d;
          if (k - 1 < 0) {
            a = 0;
          } else {
            a = bitmap[(k - 1) * s][i];
          }
          if (k - 3 < 0) {
            c = 0;
          } else {
            c = bitmap[(k - 3) * s][i];
          }
          if (k + 1 > kmax) {
            b = 0;
          } else {
            b = bitmap[(k + 1) * s][i];
          }
          if (k + 3 > kmax) {
            d = 0;
          } else {
            d = bitmap[(k + 3) * s][i];
          }
          bitmap[k * s][i] += 9 * (a + b) - (c + d) + 16 >> 5;
        }
      }
    }
    filter_fh(s, bitmap) {
      var kmax = Math.floor((bitmap.width - 1) / s);
      for (var i = 0; i < bitmap.height; i += s) {
        for (var k = 1; k <= kmax; k += 2) {
          if (k - 3 >= 0 && k + 3 <= kmax) {
            bitmap[i][k * s] -= 9 * (bitmap[i][(k - 1) * s] + bitmap[i][(k + 1) * s]) - (bitmap[i][(k - 3) * s] + bitmap[i][(k + 3) * s]) + 8 >> 4;
          } else if (k + 1 <= kmax) {
            bitmap[i][k * s] -= bitmap[i][(k - 1) * s] + bitmap[i][(k + 1) * s] + 1 >> 1;
          } else {
            bitmap[i][k * s] -= bitmap[i][(k - 1) * s];
          }
        }
        for (var k = 0; k <= kmax; k += 2) {
          var a, b, c, d;
          if (k - 1 < 0) {
            a = 0;
          } else {
            a = bitmap[i][(k - 1) * s];
          }
          if (k - 3 < 0) {
            c = 0;
          } else {
            c = bitmap[i][(k - 3) * s];
          }
          if (k + 1 > kmax) {
            b = 0;
          } else {
            b = bitmap[i][(k + 1) * s];
          }
          if (k + 3 > kmax) {
            d = 0;
          } else {
            d = bitmap[i][(k + 3) * s];
          }
          bitmap[i][k * s] += 9 * (a + b) - (c + d) + 16 >> 5;
        }
      }
    }
    // переводим матрицу в блоки
    createBlocks(bitmap) {
      var blockRows = Math.ceil(this.height / 32);
      var blockCols = Math.ceil(this.width / 32);
      var length = blockRows * blockCols;
      var buffer = new ArrayBuffer(length << 11);
      this.blocks = [];
      for (var r = 0; r < blockRows; r++) {
        for (var c = 0; c < blockCols; c++) {
          var block = new Block(buffer, r * blockCols + c << 11, true);
          for (var i = 0; i < 1024; i++) {
            var val2 = 0;
            if (bitmap[this.zigzagRow[i] + 32 * r]) {
              val2 = bitmap[this.zigzagRow[i] + 32 * r][this.zigzagCol[i] + 32 * c];
              val2 = val2 || 0;
            }
            block.setCoef(i, val2);
          }
          this.blocks.push(block);
        }
      }
      buffer = new ArrayBuffer(length << 11);
      this.eblocks = new Array(length);
      for (var i = 0; i < length; i++) {
        this.eblocks[i] = new Block(buffer, i << 11, true);
      }
    }
    encodeSlice(zp) {
      this.zp = zp;
      if (!this.is_null_slice()) {
        for (var i = 0; i < this.blocks.length; i++) {
          var block = this.blocks[i];
          var eblock = this.eblocks[i];
          this.preliminaryFlagComputation(block, eblock);
          if (this.blockBandEncodingPass()) {
            this.bucketEncodingPass(eblock);
            this.newlyActiveCoefficientEncodingPass(block, eblock);
          }
          this.previouslyActiveCoefficientEncodingPass(block, eblock);
        }
      }
      return this.finish_code_slice();
    }
    previouslyActiveCoefficientEncodingPass(block, eblock) {
      var boff = 0;
      var step = this.quant_hi[this.curband];
      var indices = this.getBandBuckets(this.curband);
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        for (var j = 0; j < 16; j++) {
          if (this.coeffstate[boff][j] & this.ACTIVE) {
            if (!this.curband) {
              step = this.quant_lo[j];
            }
            var des = 0;
            var coef = Math.abs(block.buckets[i][j]);
            var ecoef = eblock.buckets[i][j];
            var pix = coef >= ecoef ? 1 : 0;
            if (ecoef <= 3 * step) {
              this.zp.encode(pix, this.inreaseCoefCtx, 0);
            } else {
              this.zp.IWencode(pix);
            }
            eblock.buckets[i][j] = ecoef - (pix ? 0 : step) + (step >> 1);
          }
        }
      }
    }
    newlyActiveCoefficientEncodingPass(block, eblock) {
      var boff = 0;
      var indices = this.getBandBuckets(this.curband);
      var step = this.quant_hi[this.curband];
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        if (this.bucketstate[boff] & this.NEW) {
          var shift = 0;
          if (this.bucketstate[boff] & this.ACTIVE) {
            shift = 8;
          }
          var bucket = block.buckets[i];
          var ebucket = eblock.buckets[i];
          var np = 0;
          for (var j = 0; j < 16; j++) {
            if (this.coeffstate[boff][j] & this.UNK) {
              np++;
            }
          }
          for (var j = 0; j < 16; j++) {
            if (this.coeffstate[boff][j] & this.UNK) {
              var ip = Math.min(7, np);
              this.zp.encode(this.coeffstate[boff][j] & this.NEW ? 1 : 0, this.activateCoefCtx, shift + ip);
              if (this.coeffstate[boff][j] & this.NEW) {
                this.zp.IWencode(bucket[j] < 0 ? 1 : 0);
                np = 0;
                if (!this.curband) {
                  step = this.quant_lo[j];
                }
                ebucket[j] = step + (step >> 1) - (step >> 3);
                ebucket[j] = step + (step >> 1);
              }
              if (np) {
                np--;
              }
            }
          }
        }
      }
    }
    bucketEncodingPass(eblock) {
      var indices = this.getBandBuckets(this.curband);
      var boff = 0;
      for (var i = indices.from; i <= indices.to; i++, boff++) {
        if (!(this.bucketstate[boff] & this.UNK)) {
          continue;
        }
        var n = 0;
        if (this.curband) {
          var t = 4 * i;
          for (var j = t; j < t + 4; j++) {
            if (eblock.getCoef(j)) {
              n++;
            }
          }
          if (n === 4) {
            n--;
          }
        }
        if (this.bbstate & this.ACTIVE) {
          n |= 4;
        }
        this.zp.encode(this.bucketstate[boff] & this.NEW ? 1 : 0, this.decodeCoefCtx, n + this.curband * 8);
      }
    }
    blockBandEncodingPass() {
      var indices = this.getBandBuckets(this.curband);
      var bcount = indices.to - indices.from + 1;
      if (bcount < 16 || this.bbstate & this.ACTIVE) {
        this.bbstate |= this.NEW;
      } else if (this.bbstate & this.UNK) {
        this.zp.encode(this.bbstate & this.NEW ? 1 : 0, this.decodeBucketCtx, 0);
      }
      return this.bbstate & this.NEW;
    }
    // принимает исходный блок и кодируемый блок. Взято из djvulibre
    preliminaryFlagComputation(block, eblock) {
      this.bbstate = 0;
      var bstatetmp = 0;
      var indices = this.getBandBuckets(this.curband);
      var step = this.quant_hi[this.curband];
      if (this.curband) {
        var boff = 0;
        for (var j = indices.from; j <= indices.to; j++, boff++) {
          bstatetmp = 0;
          var bucket = block.buckets[j];
          var ebucket = eblock.buckets[j];
          for (var k = 0; k < bucket.length; k++) {
            if (ebucket[k]) {
              this.coeffstate[boff][k] = this.ACTIVE;
            } else if (bucket[k] >= step || bucket[k] <= -step) {
              this.coeffstate[boff][k] = this.UNK | this.NEW;
            } else {
              this.coeffstate[boff][k] = this.UNK;
            }
            bstatetmp |= this.coeffstate[boff][k];
          }
          this.bucketstate[boff] = bstatetmp;
          this.bbstate |= bstatetmp;
        }
      } else {
        var bucket = block.buckets[0];
        var ebucket = eblock.buckets[0];
        for (var k = 0; k < bucket.length; k++) {
          step = this.quant_lo[k];
          if (this.coeffstate[0][k] !== this.ZERO) {
            if (ebucket[k]) {
              this.coeffstate[0][k] = this.ACTIVE;
            } else if (bucket[k] >= step || bucket[k] <= -step) {
              this.coeffstate[0][k] = this.UNK | this.NEW;
            } else {
              this.coeffstate[0][k] = this.UNK;
            }
          }
          bstatetmp |= this.coeffstate[0][k];
        }
        this.bucketstate[0] = bstatetmp;
        this.bbstate |= bstatetmp;
      }
    }
  };

  // package/library/src/iw44/IWImageWriter.js
  var IWImageWriter = class {
    constructor(slicenumber, delayInit, grayscale) {
      this.slicenumber = slicenumber || 100;
      this.grayscale = grayscale || 0;
      this.delayInit = delayInit & 127 || 0;
      this.onprocess = void 0;
    }
    get width() {
      return this.imageData.width;
    }
    get height() {
      return this.imageData.height;
    }
    startMultiPageDocument() {
      this.dw = new DjVuWriter();
      this.dw.startDJVM();
      this.pageBuffers = [];
      var dirm = {};
      this.dirm = dirm;
      dirm.offsets = [];
      dirm.dflags = 129;
      dirm.flags = [];
      dirm.ids = [];
      dirm.sizes = [];
    }
    addPageToDocument(imageData) {
      var tbsw = new ByteStreamWriter();
      this.writeImagePage(tbsw, imageData);
      var buffer = tbsw.getBuffer();
      this.pageBuffers.push(buffer);
      this.dirm.flags.push(1);
      this.dirm.ids.push("p" + this.dirm.ids.length);
      this.dirm.sizes.push(buffer.byteLength);
    }
    endMultiPageDocument() {
      this.dw.writeDirmChunk(this.dirm);
      var len = this.pageBuffers.length;
      for (var i = 0; i < len; i++) {
        this.dw.writeFormChunkBuffer(this.pageBuffers.shift());
      }
      var buffer = this.dw.getBuffer();
      delete this.dw;
      delete this.pageBuffers;
      delete this.dirm;
      return buffer;
    }
    createMultiPageDocument(imageArray) {
      var dw = new DjVuWriter();
      dw.startDJVM();
      var length = imageArray.length;
      var pageBuffers = new Array(imageArray.length);
      var dirm = {};
      this.dirm = dirm;
      dirm.offsets = [];
      dirm.dflags = 129;
      dirm.flags = new Array(imageArray.length);
      dirm.ids = new Array(imageArray.length);
      dirm.sizes = new Array(imageArray.length);
      var tbsw = new ByteStreamWriter();
      for (var i = 0; i < imageArray.length; i++) {
        this.writeImagePage(tbsw, imageArray[i]);
        var buffer = tbsw.getBuffer();
        pageBuffers[i] = buffer;
        tbsw.reset();
        dirm.flags[i] = 1;
        dirm.ids[i] = "p" + i;
        dirm.sizes[i] = buffer.byteLength;
        this.onprocess ? this.onprocess((i + 1) / length) : 0;
      }
      dw.writeDirmChunk(dirm);
      for (var i = 0; i < imageArray.length; i++) {
        dw.writeFormChunkBuffer(pageBuffers[i]);
      }
      return new DjVuDocument(dw.getBuffer());
    }
    /**
     * Кодирует и записывает в поток 1 картинку
     */
    writeImagePage(bsw, imageData) {
      bsw.writeStr("FORM").saveOffsetMark("formSize").jump(4).writeStr("DJVU");
      bsw.writeStr("INFO").writeInt32(10).writeInt16(imageData.width).writeInt16(imageData.height).writeByte(24).writeByte(0).writeByte(100 & 255).writeByte(100 >> 8).writeByte(22).writeByte(1);
      bsw.writeStr("BG44").saveOffsetMark("BG44Size").jump(4);
      bsw.writeByte(0).writeByte(this.slicenumber).writeByte(this.grayscale << 7 | 1).writeByte(2).writeUint16(imageData.width).writeUint16(imageData.height).writeByte(this.delayInit);
      var ycodec = new IWEncoder(this.RGBtoY(imageData));
      var crcodec, cbcodec;
      if (!this.grayscale) {
        cbcodec = new IWEncoder(this.RGBtoCb(imageData));
        crcodec = new IWEncoder(this.RGBtoCr(imageData));
      }
      var zp = new ZPEncoder(bsw);
      for (var i = 0; i < this.slicenumber; i++) {
        ycodec.encodeSlice(zp);
        if (cbcodec && crcodec && i >= this.delayInit) {
          cbcodec.encodeSlice(zp);
          crcodec.encodeSlice(zp);
        }
      }
      zp.eflush();
      bsw.rewriteSize("formSize");
      bsw.rewriteSize("BG44Size");
    }
    createOnePageDocument(imageData) {
      var bsw = new ByteStreamWriter(10 * 1024);
      bsw.writeStr("AT&T");
      this.writeImagePage(bsw, imageData);
      return new DjVuDocument(bsw.getBuffer());
    }
    /**
     * Перевод RGB в Y откопировано из djvulibre
     * @param {ImageData} imageData
     * @returns {Bytemap} двумерный байтовый массив
     */
    RGBtoY(imageData) {
      var rmul = new Int32Array(256);
      var gmul = new Int32Array(256);
      var bmul = new Int32Array(256);
      var data = imageData.data;
      var width = imageData.width;
      var height = imageData.height;
      var bytemap = new Bytemap(width, height);
      if (this.grayscale) {
        for (var i = 0; i < data.length; i++) {
          data[i] = 255 - data[i];
        }
      }
      for (var k = 0; k < 256; k++) {
        rmul[k] = k * 65536 * this.rgb_to_ycc[0][0];
        gmul[k] = k * 65536 * this.rgb_to_ycc[0][1];
        bmul[k] = k * 65536 * this.rgb_to_ycc[0][2];
      }
      for (var i = 0; i < height; i++) {
        for (var j = 0; j < width; j++) {
          var index = (height - i - 1) * width + j << 2;
          var y = rmul[data[index]] + gmul[data[index + 1]] + bmul[data[index + 2]] + 32768;
          bytemap[i][j] = (y >> 16) - 128 << this.iw_shift;
        }
      }
      return bytemap;
    }
    /**
     * Перевод RGB в Cb откопировано из djvulibre
     * @param {ImageData} imageData
     * @returns {Bytemap} двумерный байтовый массив
     */
    RGBtoCb(imageData) {
      var rmul = new Int32Array(256);
      var gmul = new Int32Array(256);
      var bmul = new Int32Array(256);
      var data = imageData.data;
      var width = imageData.width;
      var height = imageData.height;
      var bytemap = new Bytemap(width, height);
      for (var k = 0; k < 256; k++) {
        rmul[k] = k * 65536 * this.rgb_to_ycc[2][0];
        gmul[k] = k * 65536 * this.rgb_to_ycc[2][1];
        bmul[k] = k * 65536 * this.rgb_to_ycc[2][2];
      }
      for (var i = 0; i < height; i++) {
        for (var j = 0; j < width; j++) {
          var index = (height - i - 1) * width + j << 2;
          var y = rmul[data[index]] + gmul[data[index + 1]] + bmul[data[index + 2]] + 32768;
          bytemap[i][j] = Math.max(-128, Math.min(127, y >> 16)) << this.iw_shift;
        }
      }
      return bytemap;
    }
    /**
     * Перевод RGB в Cr откопировано из djvulibre
     * @param {ImageData} imageData
     * @returns {Bytemap} двумерный байтовый массив
     */
    RGBtoCr(imageData) {
      var rmul = new Int32Array(256);
      var gmul = new Int32Array(256);
      var bmul = new Int32Array(256);
      var data = imageData.data;
      var width = imageData.width;
      var height = imageData.height;
      var bytemap = new Bytemap(width, height);
      for (var k = 0; k < 256; k++) {
        rmul[k] = k * 65536 * this.rgb_to_ycc[1][0];
        gmul[k] = k * 65536 * this.rgb_to_ycc[1][1];
        bmul[k] = k * 65536 * this.rgb_to_ycc[1][2];
      }
      for (var i = 0; i < height; i++) {
        for (var j = 0; j < width; j++) {
          var index = (height - i - 1) * width + j << 2;
          var y = rmul[data[index]] + gmul[data[index + 1]] + bmul[data[index + 2]] + 32768;
          bytemap[i][j] = Math.max(-128, Math.min(127, y >> 16)) << this.iw_shift;
        }
      }
      return bytemap;
    }
  };
  IWImageWriter.prototype.iw_shift = 6;
  IWImageWriter.prototype.rgb_to_ycc = [
    [0.304348, 0.608696, 0.086956],
    [0.463768, -0.405797, -0.057971],
    [-0.173913, -0.347826, 0.521739]
  ];

  // package/library/src/DjVuWorkerScript.js
  function initWorker() {
    var djvuDocument;
    var iwiw;
    addEventListener("error", (e) => {
      console.error(e);
      postMessage("error");
    });
    addEventListener("unhandledrejection", (e) => {
      console.error(e);
      postMessage("unhandledrejection");
    });
    onmessage = async function({ data: obj }) {
      if (obj.action) return handlers[obj.action](obj);
      try {
        const { data, transferList } = await handlers[obj.command](obj) || {};
        try {
          postMessage({
            command: obj.command,
            ...data,
            ...obj.sendBackData ? { sendBackData: obj.sendBackData } : null
          }, transferList && transferList.length ? transferList : void 0);
        } catch (e) {
          throw new UnableToTransferDataDjVuError(obj.data);
        }
      } catch (error) {
        console.error(error);
        var errorObj = error instanceof DjVuError ? error : {
          code: DjVuErrorCodes.UNEXPECTED_ERROR,
          name: error.name,
          message: error.message
        };
        errorObj.commandObject = obj;
        postMessage({
          command: "Error",
          error: errorObj,
          ...obj.sendBackData ? { sendBackData: obj.sendBackData } : null
        });
      }
    };
    function processValueBeforeTransfer(value, transferList) {
      if (value instanceof ArrayBuffer) {
        transferList.push(value);
        return value;
      }
      if (value instanceof ImageData) {
        transferList.push(value.data.buffer);
        return {
          width: value.width,
          height: value.height,
          buffer: value.data.buffer
        };
      }
      if (value instanceof DjVuDocument) {
        transferList.push(value.buffer);
        return value.buffer;
      }
      return value;
    }
    function restoreHyperCallbacks(args) {
      return args.map((arg) => {
        if (arg && typeof arg === "object" && arg.hyperCallback) {
          return (...params) => postMessage({
            action: "hyperCallback",
            id: arg.id,
            args: params
          });
        }
        return arg;
      });
    }
    var handlers = {
      /* A universal command which handles all tasks created via doc proxy property of the DjVuWorker class */
      async run(obj) {
        const results = await Promise.all(obj.data.map(async (task) => {
          var res = djvuDocument;
          for (var i = 0; i < task.funcs.length; i++) {
            if (typeof res[task.funcs[i]] !== "function") {
              throw new IncorrectTaskDjVuError(task);
            }
            res = await res[task.funcs[i]](...restoreHyperCallbacks(task.args[i]));
          }
          return res;
        }));
        var transferList = [];
        var processedResults = results.map((result) => processValueBeforeTransfer(result, transferList));
        return {
          data: {
            result: processedResults.length === 1 ? processedResults[0] : processedResults
          },
          transferList
        };
      },
      revokeObjectURL(obj) {
        URL.revokeObjectURL(obj.url);
      },
      startMultiPageDocument(obj) {
        iwiw = new IWImageWriter(obj.slicenumber, obj.delayInit, obj.grayscale);
        iwiw.startMultiPageDocument();
      },
      addPageToDocument(obj) {
        var imageData = new ImageData(new Uint8ClampedArray(obj.simpleImage.buffer), obj.simpleImage.width, obj.simpleImage.height);
        iwiw.addPageToDocument(imageData);
      },
      endMultiPageDocument(obj) {
        var buffer = iwiw.endMultiPageDocument();
        return {
          data: { buffer },
          transferList: [buffer]
        };
      },
      createDocumentFromPictures(obj) {
        var sims = obj.images;
        var imageArray = new Array(sims.length);
        for (var i = 0; i < sims.length; i++) {
          imageArray[i] = new ImageData(new Uint8ClampedArray(sims[i].buffer), sims[i].width, sims[i].height);
        }
        var iw = new IWImageWriter(obj.slicenumber, obj.delayInit, obj.grayscale);
        iw.onprocess = (percent) => {
          postMessage({ action: "Process", percent });
        };
        var ndoc = iw.createMultyPageDocument(imageArray);
        return {
          data: { buffer: ndoc.buffer },
          transferList: [ndoc.buffer]
        };
      },
      createDocument(obj) {
        djvuDocument = new DjVuDocument(obj.buffer, obj.options);
      }
    };
  }

  // package/library/src/index.js
  if (!self.document) {
    initWorker();
  }
  var src_default = Object.assign({}, DjVu_default, {
    Worker: DjVuWorker,
    Document: DjVuDocument,
    ErrorCodes: DjVuErrorCodes
  });

  // entry.js
  if (typeof self !== "undefined") {
    self.DjVu = src_default;
  }
})();
