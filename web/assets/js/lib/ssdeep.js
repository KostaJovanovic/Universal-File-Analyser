/* Analyser - ssdeep / context-triggered piecewise hashing (CTPH).

   DOM-free. A cryptographic hash answers "are these the same file"; one changed
   byte and every character of the digest changes. A fuzzy hash answers "how much
   of this file is the same", which is the question you actually have when you are
   looking at two builds of a program, a document before and after an edit, or two
   samples of the same malware family with the strings shuffled.

   The trick is choosing where to cut. Splitting the file into fixed blocks fails
   immediately: insert one byte at the front and every block boundary after it
   moves, so every block hash changes. CTPH instead slides a 7-byte window along
   the file and cuts wherever a rolling hash of that window hits a trigger value.
   The boundaries are then decided by the CONTENT around them, so inserting a byte
   moves one boundary and leaves the rest where they were. Each block contributes
   one base64 character, and the resulting string is compared by edit distance.

   The block size is chosen so the signature lands near 64 characters, which is why
   a signature carries it as a prefix, and why two files can only be compared when
   their block sizes are equal or one is double the other - hence the second,
   double-block-size signature every hash carries as well.

   This is a from-scratch implementation of the published spamsum algorithm
   (Andrew Tridgell, 2002) as ssdeep standardised it: same rolling hash, same FNV
   block hash, same trigger rule, same scoring - so the strings it produces are
   the ordinary ones and can be compared against a hash from anywhere else. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SPAMSUM_LENGTH = 64;
const MIN_BLOCKSIZE = 3;
const ROLLING_WINDOW = 7;
const HASH_PRIME = 0x01000193;
const HASH_INIT = 0x28021967;
/* The rolling hash. Three cheap accumulators over the last 7 bytes, summed: h1 is
   the running total, h2 weights recent bytes more heavily, and h3 is a shift-xor
   that separates windows h1 and h2 would agree on. Only its value modulo the
   block size matters - it decides where a block ends. */
class Roll {
    h1 = 0;
    h2 = 0;
    h3 = 0;
    n = 0;
    win = new Uint8Array(ROLLING_WINDOW);
    update(c) {
        this.h2 = (this.h2 - this.h1 + ROLLING_WINDOW * c) >>> 0;
        this.h1 = (this.h1 + c - this.win[this.n]) >>> 0;
        this.win[this.n] = c;
        this.n = (this.n + 1) % ROLLING_WINDOW;
        this.h3 = (((this.h3 << 5) >>> 0) ^ c) >>> 0;
        return (this.h1 + this.h2 + this.h3) >>> 0;
    }
    reset() { this.h1 = this.h2 = this.h3 = this.n = 0; this.win.fill(0); }
}
// FNV-1 over one byte, 32-bit. Math.imul because a plain * overflows to a double
// and silently stops being the 32-bit multiply the algorithm specifies.
function fnv(h, c) { return ((Math.imul(h, HASH_PRIME) >>> 0) ^ c) >>> 0; }
/** Compute the ssdeep signature of a byte array: "blocksize:hash:doubleHash". */
export function ssdeepHash(buf) {
    const n = buf.length;
    if (!n)
        return '3::';
    // Start with a block size that would give roughly SPAMSUM_LENGTH blocks, then
    // halve it and start over if the signature came out too short - a small file
    // with few trigger points needs finer cuts to say anything useful.
    let bs = MIN_BLOCKSIZE;
    while (bs * SPAMSUM_LENGTH < n)
        bs *= 2;
    const roll = new Roll();
    let sig = [], sig2 = [];
    let h = HASH_INIT, h2 = HASH_INIT, h3 = 0;
    for (;;) {
        sig = [];
        sig2 = [];
        h = HASH_INIT;
        h2 = HASH_INIT;
        h3 = 0;
        roll.reset();
        let j = 0, k = 0;
        const bs2 = bs * 2;
        for (let i = 0; i < n; i++) {
            const c = buf[i];
            h3 = roll.update(c);
            h = fnv(h, c);
            h2 = fnv(h2, c);
            if (h3 % bs === bs - 1) {
                // The last slot is overwritten rather than appended once the signature is
                // full, which is what keeps it to SPAMSUM_LENGTH characters exactly.
                sig[j] = B64[h % 64];
                if (j < SPAMSUM_LENGTH - 1) {
                    h = HASH_INIT;
                    j++;
                }
            }
            if (h3 % bs2 === bs2 - 1) {
                sig2[k] = B64[h2 % 64];
                if (k < SPAMSUM_LENGTH / 2 - 1) {
                    h2 = HASH_INIT;
                    k++;
                }
            }
        }
        if (bs > MIN_BLOCKSIZE && j < SPAMSUM_LENGTH / 2) {
            bs = Math.floor(bs / 2);
            continue;
        }
        // Whatever is left in the accumulators is a final partial block.
        if (h3 !== 0) {
            sig[j] = B64[h % 64];
            sig2[k] = B64[h2 % 64];
        }
        break;
    }
    return bs + ':' + sig.join('') + ':' + sig2.join('');
}
/** Hash a File. Returns null if it is too large to read in one piece. */
export async function ssdeepFile(file, maxBytes) {
    if (!file || file.size > maxBytes)
        return null;
    try {
        return ssdeepHash(new Uint8Array(await file.arrayBuffer()));
    }
    catch (_) {
        return null;
    }
}
// Runs of the same character longer than three carry no information about where
// the file's content actually is, and left in place they let two files that are
// mostly padding score as similar. Collapsed to three before scoring.
function eliminateSequences(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (i >= 3 && s[i] === s[i - 1] && s[i] === s[i - 2] && s[i] === s[i - 3])
            continue;
        out += s[i];
    }
    return out;
}
// Two signatures with nothing as long as the rolling window in common are not
// related, whatever the edit distance says - the score would just be measuring
// how short they both are.
function hasCommonSubstring(a, b) {
    if (a.length < ROLLING_WINDOW || b.length < ROLLING_WINDOW)
        return false;
    const seen = new Set();
    for (let i = 0; i + ROLLING_WINDOW <= a.length; i++)
        seen.add(a.substr(i, ROLLING_WINDOW));
    for (let i = 0; i + ROLLING_WINDOW <= b.length; i++)
        if (seen.has(b.substr(i, ROLLING_WINDOW)))
            return true;
    return false;
}
// Levenshtein with ssdeep's costs: insert and delete 1, substitute 2. Two rows
// rather than a full matrix - the strings are at most 64 characters, but there is
// no reason to allocate 4 KB per comparison.
function editDist(a, b) {
    const m = a.length, n = b.length;
    let prev = new Int32Array(n + 1), cur = new Int32Array(n + 1);
    for (let j = 0; j <= n; j++)
        prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 2);
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
        }
        const t = prev;
        prev = cur;
        cur = t;
    }
    return prev[n];
}
function scoreStrings(s1, s2, blockSize) {
    if (s1.length > SPAMSUM_LENGTH || s2.length > SPAMSUM_LENGTH)
        return 0;
    if (!hasCommonSubstring(s1, s2))
        return 0;
    let score = editDist(s1, s2);
    score = Math.floor((score * SPAMSUM_LENGTH) / (s1.length + s2.length));
    score = Math.floor((100 * score) / SPAMSUM_LENGTH);
    score = 100 - score;
    // A small block size means each character stands for very little of the file,
    // so a high score off a short signature is not evidence of much. The cap keeps
    // "similar" from meaning "both tiny".
    const cap = Math.floor(blockSize / MIN_BLOCKSIZE) * Math.min(s1.length, s2.length);
    return Math.max(0, Math.min(score, cap));
}
/** Compare two ssdeep signatures. 0 = nothing in common, 100 = as alike as this
    can measure. Returns 0 when the two block sizes are not comparable, which is
    an honest "cannot tell" rather than a claim of dissimilarity. */
export function ssdeepCompare(a, b) {
    if (!a || !b)
        return 0;
    const pa = a.split(':'), pb = b.split(':');
    if (pa.length < 3 || pb.length < 3)
        return 0;
    const bs1 = parseInt(pa[0], 10), bs2 = parseInt(pb[0], 10);
    if (!isFinite(bs1) || !isFinite(bs2) || bs1 < MIN_BLOCKSIZE || bs2 < MIN_BLOCKSIZE)
        return 0;
    if (bs1 !== bs2 && bs1 !== bs2 * 2 && bs2 !== bs1 * 2)
        return 0;
    const a1 = eliminateSequences(pa[1]), a2 = eliminateSequences(pa[2]);
    const b1 = eliminateSequences(pb[1]), b2 = eliminateSequences(pb[2]);
    if (bs1 === bs2) {
        if (a1 === b1 && a2 === b2)
            return 100;
        return Math.max(scoreStrings(a1, b1, bs1), scoreStrings(a2, b2, bs1 * 2));
    }
    // Different block sizes: line up the signature computed at the same one.
    if (bs1 === bs2 * 2)
        return scoreStrings(a1, b2, bs1);
    return scoreStrings(a2, b1, bs2);
}
//# sourceMappingURL=ssdeep.js.map