export const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
export const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
export const ERROR_TERMINATED = new Error("called FFmpeg.terminate()");
export const ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");
// Used by ffmpeg-util.js (downloadWithProgress). This file ships @ffmpeg/ffmpeg's
// four errors, but the bundled util module is from @ffmpeg/util and also imports
// these two - without them the whole ffmpeg-util.js module fails to load, so every
// `import(...ffmpeg-util.js)` for fetchFile threw and no ffmpeg feature (reverse,
// transcode, remux, frame grab, audio extract) could run at all.
export const ERROR_RESPONSE_BODY_READER = new Error("failed to get response body reader");
export const ERROR_INCOMPLETED_DOWNLOAD = new Error("failed to complete download");
