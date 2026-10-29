// Fixes applied to nanoPRC's source when tools/nanoprc/build.mjs compiles it.
// Each one replaces an exact string in one file; the build fails if the string
// is no longer there, so an upstream change can never silently skip a fix (or
// half-apply it). When upstream fixes one, delete it here.
//
// These are modifications to an AGPL work and are published as such: this file
// is part of the corresponding source of web/assets/vendor/nanoprc/.

export const PATCHES = [
  {
    file: 'src/prc_tessellation_exact_geom.c',
    why: 'Single wire body: the allocation check tests the struct field (still NULL) '
      + 'instead of the pointer just allocated, so every wire edge reports an '
      + 'allocation failure and aborts the whole exact-geometry pass.',
    find: `                        (prc_exact_geom_wire_data *)prc_calloc(ctx, 1, sizeof(prc_exact_geom_wire_data));
                    if (data->exact_geom_tess_part[geom_count].shells[i].faces[j].wire_data == NULL)`,
    replace: `                        (prc_exact_geom_wire_data *)prc_calloc(ctx, 1, sizeof(prc_exact_geom_wire_data));
                    if (wire_data == NULL)`,
  },

  // The model tree's root. Upstream always starts from the LAST product of the
  // LAST file structure. The ModelFile section states the roots explicitly
  // (Table 36: root product occurrences, each naming its file structure and
  // product, with an "is active" bit), and they need not be that one: when
  // Adobe Acrobat saves a cross-section into an existing 3D PDF it appends a
  // file structure holding only the section curves and lists it as a SECOND
  // root, so upstream builds a tree of the section alone and the whole
  // assembly in the first file structure is never reached. These three edits
  // give the model node one child per active root; with no usable root listed
  // they fall back to upstream's choice, so a single-root file - by far the
  // common case - is read exactly as before.
  {
    file: 'src/prc_api.c',
    why: 'model roots: helper',
    find: `PRC_EXPORT int
prc_api_prep_model_tree(prc_context *ctx, prc_api_data data, uint32_t *num_parts,`,
    replace: `/* Analyser patch (tools/nanoprc/patches.mjs): the active root product
   occurrences the ModelFile lists, as (file index, product) pairs. Falls back
   to the last product of the last file structure, upstream's fixed choice,
   when none resolves. */
#define ANR_MAX_ROOTS 64
static uint32_t
anr_model_roots(prc_context *ctx, prc_api_data data, uint32_t *files,
                prc_asm_product_occurrence **products)
{
    prc_data *data_in = (prc_data *)data;
    uint32_t last = data_in->file_structure_count - 1, n = 0, r;
    prc_type_asm_modelfile *mf = data_in->file_struct[last].model;
    prc_asm_file_structure_tree *t;

    if (mf != NULL && mf->product_occurences != NULL)
    {
        for (r = 0; r < mf->number_of_root_product_occurrences && n < ANR_MAX_ROOTS; r++)
        {
            prc_product_occurrence_reference *ref = &mf->product_occurences[r];
            uint32_t bf;
            if (!ref->product_occurence_is_active)
                continue;
            bf = prc_api_helper_get_biased_file_index_from_unique_id(ctx, data, ref->unique_id);
            if (bf == 0)
                continue;
            t = data_in->file_struct[bf - 1].tree;
            if (t == NULL || ref->root_index == 0 || ref->root_index > t->product_count)
                continue;
            files[n] = bf - 1;
            products[n] = &t->products[ref->root_index - 1];
            n++;
        }
    }
    if (n == 0)
    {
        t = data_in->file_struct[last].tree;
        files[0] = last;
        products[0] = &t->products[t->product_count - 1];
        n = 1;
    }
    return n;
}

PRC_EXPORT int
prc_api_prep_model_tree(prc_context *ctx, prc_api_data data, uint32_t *num_parts,`,
  },
  {
    file: 'src/prc_api.c',
    why: 'model roots: count every root',
    find: `    code = prc_api_helper_count_items(ctx, data, num_files, last_file_index,
                                      prc_product, num_parts, num_products,
                                      num_markups);`,
    replace: `    {
        /* Analyser patch: every root the ModelFile lists (anr_model_roots). */
        uint32_t anr_files[ANR_MAX_ROOTS], anr_n, anr_r;
        prc_asm_product_occurrence *anr_products[ANR_MAX_ROOTS];
        (void)prc_product;
        anr_n = anr_model_roots(ctx, data, anr_files, anr_products);
        code = 0;
        for (anr_r = 0; anr_r < anr_n && code >= 0; anr_r++)
            code = prc_api_helper_count_items(ctx, data, num_files, anr_files[anr_r],
                                              anr_products[anr_r], num_parts, num_products,
                                              num_markups);
    }`,
  },
  {
    file: 'src/prc_api.c',
    why: 'model roots: one child per root',
    find: `    /* Special handling for the first case */
    reserve->product_index += 1;
    product_tree->children = &reserve->products[reserve->product_index];
    reserve->product_index += 1;`,
    replace: `    /* Special handling for the first case. Analyser patch: one child per
       root the ModelFile lists (anr_model_roots), not just the last product
       of the last file. prc_api_prep_model_tree counted the same roots. */
    uint32_t anr_files[ANR_MAX_ROOTS], anr_n, anr_r;
    prc_asm_product_occurrence *anr_products[ANR_MAX_ROOTS];
    anr_n = anr_model_roots(ctx, data, anr_files, anr_products);
    product_tree->num_children = anr_n;
    reserve->product_index += 1;
    product_tree->children = &reserve->products[reserve->product_index];
    reserve->product_index += anr_n;`,
  },
  {
    file: 'src/prc_api.c',
    why: 'model roots: build each root',
    find: `    prc_api_helper_add_product(ctx, data, num_files, last_file_index, NULL,
        product_transform, &last_tree->products[last_tree->product_count - 1],
        0, 0, &product_tree->children[0], reserve, NULL);`,
    replace: `    (void)prc_product; (void)num_children; (void)k;
    for (anr_r = 0; anr_r < anr_n; anr_r++)
        prc_api_helper_add_product(ctx, data, num_files, anr_files[anr_r], NULL,
            product_transform, anr_products[anr_r],
            0, 0, &product_tree->children[anr_r], reserve, NULL);`,
  },

  // Placement along a prototype chain. A product occurrence may point at a
  // prototype (which may point at another), and upstream multiplies in the
  // location of every occurrence on that chain. But an occurrence's location
  // REPLACES its prototype's - the prototype's applies only when the
  // occurrence has none. CATIA-exported sub-assemblies store the same
  // placement on both, so upstream applied it twice and every part inside a
  // sub-assembly was drawn at double its offset, floating off the model (the
  // bearings and seal pack of a pump assembly; Acrobat draws them in place).
  // These two edits keep the first location met on the chain and skip the
  // rest. A chain with one location at most - every top-level part seen so
  // far - is placed exactly as before.
  {
    file: 'src/prc_api.c',
    why: 'prototype location: one per work item',
    find: `        prc_api_add_product_work item = worklist[--worklist_size];
`,
    replace: `        prc_api_add_product_work item = worklist[--worklist_size];
        /* Analyser patch: set once this item's chain has placed it. */
        uint8_t anr_located = 0;
`,
  },
  {
    file: 'src/prc_api.c',
    why: 'prototype location: first one wins',
    find: `            if (work_product->has_transform)
            {
                code = prc_api_set_transform(ctx, &new_transform, &work_product->location);
                if (code < 0)
                {
                    prc_error(ctx, code, "Failed in prc_api_helper_add_items\\n");
                    result = code;
                    goto cleanup;
                }
                prc_api_update_transform(ctx, &work_incoming_transform, &new_transform);
            }`,
    replace: `            /* Analyser patch: an occurrence's location overrides its
               prototype's, so only the first one on the chain applies. */
            if (work_product->has_transform && !anr_located)
            {
                code = prc_api_set_transform(ctx, &new_transform, &work_product->location);
                if (code < 0)
                {
                    prc_error(ctx, code, "Failed in prc_api_helper_add_items\\n");
                    result = code;
                    goto cleanup;
                }
                prc_api_update_transform(ctx, &work_incoming_transform, &new_transform);
                anr_located = 1;
            }`,
  },
];
