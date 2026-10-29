/* Analyser - browser glue for nanoPRC
   Copyright (C) 2026 Analyser contributors

   This file links against nanoPRC (Copyright (C) 2023-2026 CascadiaVoxel LLC)
   and is distributed, like nanoPRC, under the terms of the GNU Affero General
   Public License as published by the Free Software Foundation, either version 3
   of the License, or (at your option) any later version. It is distributed
   WITHOUT ANY WARRANTY; see <https://www.gnu.org/licenses/>.

   Built by tools/nanoprc/build.mjs into web/assets/vendor/nanoprc/. Reads one
   PRC stream (the 3D model a PDF embeds) and writes every triangle the model
   tree draws, already placed in world space, to a flat little-endian file the
   page reads back:

     "ANRM"  u32 version (1)  u32 flags (1 = some colour came from the file,
                                         2 = stopped at the triangle cap
                                             or the vertex decode budget)
     u32 part count, then per part:
       u32 name length, name bytes (UTF-8, not terminated)
       u32 triangle count
       f32 positions [count * 9]
       f32 normals   [count * 9]   (the file's vertex normals where all three
                                    exist, else the face normal)
       u8  colours   [count * 9]   (RGB per corner)

   A "part" is one product node of the model tree: everything its part and the
   representation items under it draw, with the node's composed placement. The
   tree walk, the tessellation numbering (part_detail_index) and the primitive
   expansion follow nanoPRC's own demos/stl_export, which is the library's
   reference for how a model is placed; only the output differs. */

#include <prc_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <emscripten/emscripten.h>

typedef struct {
    char *name;
    float *pos, *nrm;
    uint8_t *rgb;
    uint32_t tris, cap;
} part_buf;

typedef struct {
    part_buf *parts;
    uint32_t count, cap;
    uint64_t total_tris, max_tris;
    uint32_t flags;
} out_state;

static int grow_part(part_buf *p)
{
    uint32_t cap = p->cap ? p->cap * 2 : 1024;
    float *pos = (float *)realloc(p->pos, (size_t)cap * 9 * sizeof(float));
    if (!pos) return 0;
    p->pos = pos;
    float *nrm = (float *)realloc(p->nrm, (size_t)cap * 9 * sizeof(float));
    if (!nrm) return 0;
    p->nrm = nrm;
    uint8_t *rgb = (uint8_t *)realloc(p->rgb, (size_t)cap * 9);
    if (!rgb) return 0;
    p->rgb = rgb;
    p->cap = cap;
    return 1;
}

static uint8_t to_byte(float c)
{
    if (!(c > 0.0f)) return 0;
    if (c >= 1.0f) return 255;
    return (uint8_t)(c * 255.0f + 0.5f);
}

/* The colour a corner is drawn in: a per-triangle material (compressed
   meshes), else the face's, else the tessellation's, else neutral grey -
   the order demos/obj_export resolves materials in. */
static void corner_colour(out_state *st, const prc_api_vertex *v, const prc_api_material *face_mat,
    const prc_api_tess *tess, uint8_t out[3])
{
    const float *c = NULL;
    if (v->tri_has_material) c = v->diffuse;
    else if (face_mat) c = face_mat->diffuse;
    else if (tess->is_material) c = tess->tess_material.diffuse;
    if (c) {
        st->flags |= 1;
        out[0] = to_byte(c[0]); out[1] = to_byte(c[1]); out[2] = to_byte(c[2]);
    } else {
        out[0] = out[1] = out[2] = 204;
    }
}

static void transform_normal(const prc_api_transform *xform, const float in[3], float out[3])
{
    const double *m;
    float len;
    if (xform == NULL || xform->is_identity) { out[0] = in[0]; out[1] = in[1]; out[2] = in[2]; return; }
    m = xform->matrix;
    out[0] = (float)(m[0] * in[0] + m[4] * in[1] + m[8]  * in[2]);
    out[1] = (float)(m[1] * in[0] + m[5] * in[1] + m[9]  * in[2]);
    out[2] = (float)(m[2] * in[0] + m[6] * in[1] + m[10] * in[2]);
    len = sqrtf(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
    if (len > 0.0f) { out[0] /= len; out[1] /= len; out[2] /= len; }
    else { out[0] = in[0]; out[1] = in[1]; out[2] = in[2]; }
}

/* A mirroring placement (negative determinant) reverses the winding. Column-
   major, as transform_normal reads it. */
static int mirrored(const prc_api_transform *x)
{
    const double *m;
    if (x == NULL || x->is_identity) return 0;
    m = x->matrix;
    return m[0] * (m[5] * m[10] - m[6] * m[9]) + m[1] * (m[6] * m[8] - m[4] * m[10])
         + m[2] * (m[4] * m[9] - m[5] * m[8]) < 0.0;
}

static void add_triangle(prc_context *ctx, out_state *st, part_buf *p, const prc_api_transform *xform,
    const prc_api_vertex *a, const prc_api_vertex *b, const prc_api_vertex *c,
    const prc_api_material *face_mat, const prc_api_tess *tess)
{
    const prc_api_vertex *vs[3] = { a, b, c };
    float P[3][3], N[3][3];
    double u[3], w[3], n[3], len;
    int i;

    if (st->total_tris >= st->max_tris) { st->flags |= 2; return; }
    /* Swap two corners under a mirror so faces still point out. */
    if (mirrored(xform)) { vs[1] = c; vs[2] = b; }
    for (i = 0; i < 3; i++) {
        if (xform != NULL && !xform->is_identity) {
            double in[3] = { vs[i]->position[0], vs[i]->position[1], vs[i]->position[2] }, o[3];
            prc_api_transform_point(xform, in, o);
            P[i][0] = (float)o[0]; P[i][1] = (float)o[1]; P[i][2] = (float)o[2];
        } else {
            P[i][0] = vs[i]->position[0]; P[i][1] = vs[i]->position[1]; P[i][2] = vs[i]->position[2];
        }
    }
    /* Only an exactly zero area is degenerate (see stl_export's note on units). */
    for (i = 0; i < 3; i++) { u[i] = (double)P[1][i] - P[0][i]; w[i] = (double)P[2][i] - P[0][i]; }
    n[0] = u[1] * w[2] - u[2] * w[1];
    n[1] = u[2] * w[0] - u[0] * w[2];
    n[2] = u[0] * w[1] - u[1] * w[0];
    len = sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (!(len > 0.0) || !isfinite(len)) return;

    for (i = 0; i < 3; i++) {
        if (a->normal_set && b->normal_set && c->normal_set) transform_normal(xform, vs[i]->normal, N[i]);
        else { N[i][0] = (float)(n[0] / len); N[i][1] = (float)(n[1] / len); N[i][2] = (float)(n[2] / len); }
    }
    if (p->tris == p->cap && !grow_part(p)) { st->flags |= 2; st->max_tris = st->total_tris; return; }
    memcpy(p->pos + (size_t)p->tris * 9, P, sizeof(P));
    memcpy(p->nrm + (size_t)p->tris * 9, N, sizeof(N));
    for (i = 0; i < 3; i++) corner_colour(st, vs[i], face_mat, tess, p->rgb + (size_t)p->tris * 9 + i * 3);
    p->tris++;
    st->total_tris++;
    (void)ctx;
}

/* One tessellation's triangles, through the per-face accessors nanoPRC's own
   viewer uses (demos/viewer Product::attach), which read stored, compressed
   and exact-geometry tessellations alike: each face hands out its own vertex
   list and primitives indexing into it. A compressed tessellation is a single
   face here (initialised that way below, as the viewer does). Exact geometry
   has one primitive per face, and its face count is the primitive count. */
static void add_tessellation(prc_context *ctx, prc_api_data data, out_state *st, part_buf *p,
    const prc_api_tess *tess, const prc_api_transform *xform)
{
    size_t f, nf;

    if (st->total_tris >= st->max_tris) { st->flags |= 2; return; }
    if (tess->type != PRC_API_TESS_3D && tess->type != PRC_API_TESS_3D_Compressed && tess->type != PRC_API_EXACT_GEOM) return;
    nf = (tess->type == PRC_API_EXACT_GEOM) ? prc_api_get_num_graphics_primitives(ctx, data, tess) : tess->num_faces;

    for (f = 0; f < nf; f++) {
        prc_api_material fm;
        const prc_api_material *face_mat = NULL;
        prc_api_vertex *V = NULL;
        uint32_t nv = 0;
        size_t q, nprim;
        if (st->total_tris >= st->max_tris) { st->flags |= 2; return; }
        if (prc_api_skip_face(ctx, tess, (uint32_t)f)) continue;
        if (prc_api_face_is_material(ctx, tess, (uint32_t)f) > 0) {
            prc_api_get_face_material(ctx, tess, &fm, (uint32_t)f);
            face_mat = &fm;
        }
        if (prc_api_get_face_vertices(ctx, tess, (uint32_t)f, &nv, &V) < 0 || !V || !nv) continue;
        nprim = (tess->type == PRC_API_EXACT_GEOM) ? 1 : tess->tess_faces[f].num_graphic_primitives;
        for (q = 0; q < nprim; q++) {
            prc_api_graphic_primitive prim;
            size_t k;
            if (prc_api_get_graphics_primitive(ctx, data, tess, (uint32_t)f, q, &prim) < 0) continue;
            if (prim.type == PRC_API_TRIANGLES) {
                for (k = 0; k + 2 < prim.num_indices; k += 3) {
                    uint32_t i0 = prim.indices[k], i1 = prim.indices[k + 1], i2 = prim.indices[k + 2];
                    if (i0 < nv && i1 < nv && i2 < nv) add_triangle(ctx, st, p, xform, &V[i0], &V[i1], &V[i2], face_mat, tess);
                }
            } else if (prim.type == PRC_API_STRIP) {
                for (k = 2; k < prim.num_indices; k++) {
                    uint32_t i0, i1, i2 = prim.indices[k];
                    if (k % 2 == 0) { i0 = prim.indices[k - 2]; i1 = prim.indices[k - 1]; }
                    else { i0 = prim.indices[k - 1]; i1 = prim.indices[k - 2]; }
                    if (i0 < nv && i1 < nv && i2 < nv) add_triangle(ctx, st, p, xform, &V[i0], &V[i1], &V[i2], face_mat, tess);
                }
            } else if (prim.type == PRC_API_FAN) {
                for (k = 2; k < prim.num_indices; k++) {
                    uint32_t i0 = prim.indices[0], i1 = prim.indices[k - 1], i2 = prim.indices[k];
                    if (i0 < nv && i1 < nv && i2 < nv) add_triangle(ctx, st, p, xform, &V[i0], &V[i1], &V[i2], face_mat, tess);
                }
            }
        }
    }
}

static part_buf *new_part(out_state *st, const char *name)
{
    if (st->count == st->cap) {
        uint32_t cap = st->cap ? st->cap * 2 : 16;
        part_buf *grown = (part_buf *)realloc(st->parts, cap * sizeof(part_buf));
        if (!grown) return NULL;
        st->parts = grown;
        st->cap = cap;
    }
    part_buf *p = &st->parts[st->count++];
    memset(p, 0, sizeof(*p));
    if (name && *name) {
        p->name = (char *)malloc(strlen(name) + 1);
        if (p->name) strcpy(p->name, name);
    }
    return p;
}

static void walk(prc_context *ctx, prc_api_data data, out_state *st, prc_api_tess *tesses,
    uint32_t ntess, prc_api_product *node, prc_api_transform parent, int depth)
{
    prc_api_transform world = parent;
    size_t k;

    if (depth > 256) return;
    prc_api_update_transform(ctx, &world, &node->location);

    if (node->part != NULL) {
        const prc_api_part **stack;
        size_t sp = 0, scap = 16;
        part_buf *p = new_part(st, node->name ? node->name : node->part->name);
        stack = (const prc_api_part **)malloc(scap * sizeof(*stack));
        if (p && stack) {
            stack[sp++] = node->part;
            while (sp > 0) {
                const prc_api_part *item = stack[--sp];
                size_t ri;
                /* item->tess is set by the API for stored AND exact-geometry
                   tessellations (the viewer draws from it); the numbered
                   lookup stl_export uses is the fallback for stored ones. */
                if (item->tess != NULL)
                    add_tessellation(ctx, data, st, p, item->tess, &world);
                else if (item->biased_tess_index > 0 && item->part_detail_index < ntess)
                    add_tessellation(ctx, data, st, p, &tesses[item->part_detail_index], &world);
                for (ri = item->num_rep_items; ri > 0; ri--) {
                    if (sp == scap) {
                        const prc_api_part **g = (const prc_api_part **)realloc((void *)stack, scap * 2 * sizeof(*stack));
                        if (!g) break;
                        stack = g;
                        scap *= 2;
                    }
                    stack[sp++] = &item->rep_items[ri - 1];
                }
            }
        }
        free((void *)stack);
    }
    for (k = 0; k < node->num_children; k++)
        walk(ctx, data, st, tesses, ntess, &node->children[k], world, depth + 1);
}

static int put32(FILE *f, uint32_t v) { return fwrite(&v, 4, 1, f) == 1; }

/* Returns the number of triangles written (>= 0), or a negative step code
   when the file could not be read: -1 context, -2 open/parse, -3 tree,
   -4 tessellation count, -5 tessellation decode, -6 output. */
EMSCRIPTEN_KEEPALIVE
int anr_prc_mesh(const char *in_path, const char *out_path, uint32_t max_tris)
{
    prc_context *ctx = NULL;
    prc_api_data data = NULL;
    prc_api_product *tree = NULL;
    prc_api_tess *tesses = NULL, *exact = NULL;
    uint32_t nparts = 0, nproducts = 0, nmarkups = 0;
    uint32_t ntess = 0, nline = 0, nextra = 0, nexact = 0, i;
    out_state st;
    uint64_t verts = 0;   /* decoded vertices, against the max_tris budget */
    int ret = 0;
    FILE *out = NULL;

    memset(&st, 0, sizeof(st));
    st.max_tris = max_tris ? max_tris : 0xFFFFFFFFu;

    ctx = prc_api_new_context(NULL);
    if (!ctx) return -1;
    data = prc_api_open_contents(ctx, in_path);
    if (!data) { prc_api_release_context(ctx); return -2; }

    if (prc_api_prep_model_tree(ctx, data, &nparts, &nproducts, &nmarkups) < 0 ||
        prc_api_create_model_tree(ctx, data, &tree, nparts, nproducts, nmarkups) < 0) { ret = -3; goto done; }
    if (prc_api_get_number_tessellations(ctx, data, tree, &ntess, &nline, &nextra, 0) < 0) { ret = -4; goto done; }

    if (ntess) {
        tesses = (prc_api_tess *)calloc(ntess, sizeof(prc_api_tess));
        if (!tesses) { ntess = 0; ret = -5; goto done; }
    }
    /* Every tessellation is decoded before the walk, at ~116 bytes a vertex
       (prc_api_vertex), so the triangle cap alone would come too late: stop
       decoding once max_tris vertices are held. A skipped entry stays all
       zero (type 0, nothing attached to the tree), which add_tessellation and
       prc_api_release_data both pass over. One compressed tessellation is a
       single call, so a mesh bigger than the budget is still read whole. */
    for (i = 0; i < ntess; i++) {
        prc_api_tess *t = &tesses[i];
        uint8_t has_lines = 0;
        uint32_t j, nf;
        if (verts >= st.max_tris) { st.flags |= 2; break; }
        nf = prc_api_get_number_faces(ctx, data, i);
        /* A compressed tessellation is handled as one face: its vertices come
           back whole for any face index (demos/viewer Scene::load does this). */
        if (prc_api_get_tessellation_type(ctx, data, i) == PRC_API_TESS_3D_Compressed) nf = 1;
        t->num_faces = nf;
        t->tess_faces = (prc_api_face *)calloc(nf ? nf : 1, sizeof(prc_api_face));
        if (!t->tess_faces) { ret = -5; goto done; }
        if (prc_api_initialize_tessellation(ctx, data, tree, i, t, NULL, &has_lines) < 0) continue;
        if (t->type != PRC_API_TESS_3D && t->type != PRC_API_TESS_3D_Compressed) continue;
        for (j = 0; j < t->num_faces; j++) {
            prc_api_vertex *V;
            uint32_t nv = 0;
            if (verts >= st.max_tris) { st.flags |= 2; break; }
            if (prc_api_get_tessellation_vertices(ctx, data, i, j, t->tess_faces + j, t) < 0) break;
            if (prc_api_get_face_vertices(ctx, t, j, &nv, &V) == 0) verts += nv;
        }
    }

    /* Exact geometry (B-rep) with no stored triangles: nanoPRC tessellates it
       here, object -> shell -> face, attaching each result to the parts that
       draw it. The shell arrays are ours to allocate and free; the library
       frees what it puts in them (prc_api_release_exact_geometry_tessellation).
       nextra stays 0 - and this block idle - unless the build switched the
       tessellator on (build.mjs --exact); upstream ships it off. Wire bodies
       come back as line primitives, which add_tessellation does not draw. */
    if (nextra > 0) {
        uint32_t tcount = 0, k, j;
        nexact = prc_api_get_number_exact_geom_objects(ctx, data);
        if (nexact) {
            exact = (prc_api_tess *)calloc(nexact, sizeof(prc_api_tess));
            if (!exact) { nexact = 0; ret = -5; goto done; }
        }
        for (k = 0; k < nexact; k++) {
            uint32_t ns = prc_api_get_number_exact_geom_shells(ctx, data, k);
            exact[k].num_shells = ns;
            exact[k].shells = (prc_api_shell *)calloc(ns ? ns : 1, sizeof(prc_api_shell));
            if (!exact[k].shells) { exact[k].num_shells = 0; continue; }
            for (j = 0; j < ns; j++) {
                uint32_t nf = prc_api_get_number_exact_geom_faces(ctx, data, k, j), f;
                exact[k].shells[j].num_faces = nf;
                exact[k].shells[j].shell_faces = (prc_api_face *)calloc(nf ? nf : 1, sizeof(prc_api_face));
                if (!exact[k].shells[j].shell_faces) { exact[k].shells[j].num_faces = 0; continue; }
                for (f = 0; f < nf; f++)
                    prc_api_get_exact_geometry_tessellation_vertices(ctx, data, tree, k, j, f, tcount++, exact);
            }
        }
    }

    if (tree) {
        prc_api_transform root;
        prc_api_set_transform_identity(ctx, &root);
        walk(ctx, data, &st, tesses, ntess, tree, root, 0);
    }

    out = fopen(out_path, "wb");
    if (!out) { ret = -6; goto done; }
    {
        uint32_t used = 0;
        for (i = 0; i < st.count; i++) if (st.parts[i].tris) used++;
        if (fwrite("ANRM", 1, 4, out) != 4 || !put32(out, 1) || !put32(out, st.flags) || !put32(out, used)) { ret = -6; goto done; }
        for (i = 0; i < st.count; i++) {
            part_buf *p = &st.parts[i];
            uint32_t nl = p->name ? (uint32_t)strlen(p->name) : 0;
            if (!p->tris) continue;
            if (!put32(out, nl) || (nl && fwrite(p->name, 1, nl, out) != nl) || !put32(out, p->tris) ||
                fwrite(p->pos, sizeof(float), (size_t)p->tris * 9, out) != (size_t)p->tris * 9 ||
                fwrite(p->nrm, sizeof(float), (size_t)p->tris * 9, out) != (size_t)p->tris * 9 ||
                fwrite(p->rgb, 1, (size_t)p->tris * 9, out) != (size_t)p->tris * 9) { ret = -6; goto done; }
        }
    }
    ret = (int)(st.total_tris > 0x7FFFFFFF ? 0x7FFFFFFF : st.total_tris);

done:
    if (out) fclose(out);
    for (i = 0; i < st.count; i++) {
        free(st.parts[i].name); free(st.parts[i].pos); free(st.parts[i].nrm); free(st.parts[i].rgb);
    }
    free(st.parts);
    /* The library frees what it allocated inside these; the arrays themselves
       (tesses, each tess_faces, exact and its shells) are the caller's, as in
       demos/viewer Scene::load. */
    prc_api_release_data(ctx, data, tesses, ntess, NULL, 0, exact, nexact, tree);
    for (i = 0; tesses && i < ntess; i++) free(tesses[i].tess_faces);
    free(tesses);
    for (i = 0; exact && i < nexact; i++) {
        uint32_t j;
        for (j = 0; j < exact[i].num_shells; j++) free(exact[i].shells[j].shell_faces);
        free(exact[i].shells);
    }
    free(exact);
    prc_api_release_context(ctx);
    return ret;
}
