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
    // Analyser patch: a failed open (corrupt archive, unsupported codec) used to
    // leave its worker - and the file copy in its WASM heap - running forever.
    return arch.open().catch((e) => { arch.close(); throw e; });
  }

  constructor(file, options) {
    this._worker = new Worker(options.workerUrl);
    this._worker.addEventListener('message', this._workerMsg.bind(this));
    // Analyser patch: a worker that fails to load (offline, WASM fetch error) or
    // dies fires 'error', never a message - reject every pending call instead of
    // leaving the caller awaiting forever.
    const fail = (ev) => {
      const pending = this._callbacks.splice(0);
      const err = { type: 'ERROR', error: (ev && ev.message) || 'libarchive worker failed' };
      for (const cb of pending) { try { cb(err); } catch (_) {} }
    };
    this._worker.addEventListener('error', fail);
    this._worker.addEventListener('messageerror', fail);
    this._callbacks = [];
    // Analyser patch: prototype-free, so an entry path segment named
    // "__proto__" / "constructor" is an ordinary key (see _getProp).
    this._content = Object.create(null);
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
    const o = Object.create(null);   // Analyser patch: see _getProp
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

  // Analyser patch (prototype pollution): entry paths come from the archive, and
  // upstream's `cur[part] = cur[part] || {}` on plain objects let a path like
  // "__proto__/html" walk onto Object.prototype and stamp a property on every
  // object in the page. Own-key test + prototype-free nodes instead.
  _getProp(obj, path) {
    const parts = path.split('/');
    if (parts[parts.length - 1] === '') parts.pop();
    let cur = obj, prev = null;
    for (const part of parts) {
      if (!Object.prototype.hasOwnProperty.call(cur, part) || !cur[part]) cur[part] = Object.create(null);
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
