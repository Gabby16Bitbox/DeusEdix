"""Validate the rebuilt cell against Full or a certified scoped reference.

The complete cell first uses the existing Full contract. If Full retessellates
unrelated geometry differently, the alternative reference uses Original only
outside the complete old/new closed volumes. Exact partitioning retains every
positive-area fragment. Neither compiler strategy can bypass both validators.
"""
from edited_collision_scope import source_edit_certificate
from surface_scope import compare_scoped_coverage
from exact_surface_identity import compare_with_exact_groups
from selected_rebuild import Refused


def compare_preserved_coverage(before,after,full,scratch,old_sources,new_sources,
                               selected,planes,key_for_surface,compare,enabled):
    dependencies=source_edit_certificate(old_sources,new_sources,selected)
    original_compare=compare
    compare=lambda a,b,p:compare_with_exact_groups(a,b,p,original_compare)
    if enabled and dependencies['valid']:
        return compare_scoped_coverage(before,after,full,dependencies,planes,compare)
    empty=lambda data:dict(data,polys=[])
    original_check=compare(empty(after),empty(before),planes)
    try:full_check=compare(after,full,planes)
    except Refused as error:
        if not dependencies['valid']:raise
        result=compare_scoped_coverage(before,after,full,dependencies,planes,compare)
        result['complete_full_refusal']=str(error)
        return result
    return dict(original_preserved_coverage=original_check,full_affected_coverage=full_check,
        certificate=dict(source_faces=0,source_dependencies=dependencies,
            criterion='Mandatory Full: every surface of the rebuilt cell passed complete bidirectional coverage.',
            selected=sorted(selected),surface_keys=[]))
