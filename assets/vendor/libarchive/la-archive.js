/* Analyser - self-contained ESM wrapper around the vendored libarchive.js
   worker (worker-bundle.js). This inlines the `Archive` + `CompressedFile`
   classes from libarchive.js@1.3.0 (src/libarchive.js + src/compressed-file.js)
   so we drive the worker directly without the upstream multi-file relative
   imports. The worker bundle locates its WASM via `wasm-gen/libarchive.wasm`
   relative to the worker script URL, so the vendored directory structure
   (worker-bundle.js + wasm-gen/libarchive.wasm) is preserved.

   Message protocol (worker-bundle.js): HELLO->READY, OPEN->OPENED,
   LIST_FILES yields ENTRY messages then END, EXTRACT_SINGLE_FILE->FILE, with
   BUSY/ERROR for failures.
   Upstream source: https://unpkg.com/libarchive.js@1.3.0/src/libarchive.js */

export class CompressedFile {
  constructor(name, size, path, archiveRef) {
    this._name = name;
    this._size = size;
    this._path = path;
    this._archiveRef = archiveRef;
  }
  get name() { return this._name; }
  get size() { return this._size; }
  extract() { return this._archiveRef.extractSingleFile(this._path); }
}

export class Archive {
  static init(options = {}) {
    Archive._options = {
      workerUrl: '../dist/worker-bundle.js',
      ...options,
    };
    return Archive._options;
  }

  static open(file, options = null) {
    options = options || Archive._options || Archive.init();
    const arch = new Archive(file, options);
    return arch.open();
  }

  constructor(file, options) {
    this._worker = new Worker(options.workerUrl);
    this._worker.addEventListener('message', this._workerMsg.bind(this));
    this._callbacks = [];
    this._content = {};
    this._processed = 0;
    this._file = file;
  }

  async open() {
    await this._postMessage({ type: 'HELLO' }, (resolve, reject, msg) => {
      if (msg.type === 'READY') resolve();
    });
    return await this._postMessage({ type: 'OPEN', file: this._file }, (resolve, reject, msg) => {
      if (msg.type === 'OPENED') resolve(this);
    });
  }

  // Release the underlying worker. Safe to call multiple times.
  close() {
    try { if (this._worker) this._worker.terminate(); } catch (_) {}
    this._worker = null;
  }

  hasEncryptedData() {
    return this._postMessage({ type: 'CHECK_ENCRYPTION' }, (resolve, reject, msg) => {
      if (msg.type === 'ENCRYPTION_STATUS') resolve(msg.status);
    });
  }

  usePassword(archivePassword) {
    return this._postMessage({ type: 'SET_PASSPHRASE', passphrase: archivePassword }, (resolve, reject, msg) => {
      if (msg.type === 'PASSPHRASE_STATUS') resolve(msg.status);
    });
  }

  getFilesObject() {
    if (this._processed > 0) {
      return Promise.resolve().then(() => this._content);
    }
    return this._postMessage({ type: 'LIST_FILES' }, (resolve, reject, msg) => {
      if (msg.type === 'ENTRY') {
        const entry = msg.entry;
        const [target, prop] = this._getProp(this._content, entry.path);
        if (entry.type === 'FILE') {
          target[prop] = new CompressedFile(entry.fileName, entry.size, entry.path, this);
        }
        return true;
      } else if (msg.type === 'END') {
        this._processed = 1;
        resolve(this._cloneContent(this._content));
      }
    });
  }

  getFilesArray() {
    return this.getFilesObject().then((obj) => this._objectToArray(obj));
  }

  extractSingleFile(target) {
    return this._postMessage({ type: 'EXTRACT_SINGLE_FILE', target: target }, (resolve, reject, msg) => {
      if (msg.type === 'FILE') {
        const file = new File([msg.entry.fileData], msg.entry.fileName, {
          type: 'application/octet-stream',
        });
        resolve(file);
      }
    });
  }

  _cloneContent(obj) {
    if (obj instanceof File || obj instanceof CompressedFile || obj === null) return obj;
    const o = {};
    for (const prop of Object.keys(obj)) o[prop] = this._cloneContent(obj[prop]);
    return o;
  }

  _objectToArray(obj, path = '') {
    const files = [];
    for (const key of Object.keys(obj)) {
      if (obj[key] instanceof File || obj[key] instanceof CompressedFile || obj[key] === null) {
        files.push({ file: obj[key] || key, path: path });
      } else {
        files.push(...this._objectToArray(obj[key], `${path}${key}/`));
      }
    }
    return files;
  }

  _getProp(obj, path) {
    const parts = path.split('/');
    if (parts[parts.length - 1] === '') parts.pop();
    let cur = obj, prev = null;
    for (const part of parts) {
      cur[part] = cur[part] || {};
      prev = cur;
      cur = cur[part];
    }
    return [prev, parts[parts.length - 1]];
  }

  _postMessage(msg, callback) {
    this._worker.postMessage(msg);
    return new Promise((resolve, reject) => {
      this._callbacks.push(this._msgHandler.bind(this, callback, resolve, reject));
    });
  }

  _msgHandler(callback, resolve, reject, msg) {
    if (msg.type === 'BUSY') {
      reject(new Error('libarchive worker is busy'));
    } else if (msg.type === 'ERROR') {
      reject(new Error(msg.error || 'libarchive worker error'));
    } else {
      return callback(resolve, reject, msg);
    }
  }

  _workerMsg({ data: msg }) {
    const callback = this._callbacks[this._callbacks.length - 1];
    if (!callback) return;
    const next = callback(msg);
    if (!next) this._callbacks.pop();
  }
}
