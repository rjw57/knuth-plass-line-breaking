from functools import cache
from typing import Sequence

import cairo

from ._cairofontface import create_cairo_font_face_for_file, create_cairo_font_face_for_ft_face
from .font import Font, Glyph

__all__ = ["create_cairo_font_face", "context_set_font", "context_show_text_glyphs"]


@cache
def create_cairo_font_face(path: str):
    return create_cairo_font_face_for_file(path)


def context_set_font(context: cairo.Context, font: Font):
    context.set_font_face(create_cairo_font_face_for_ft_face(font.freetype_face._FT_Face))
    context.set_font_matrix(cairo.Matrix(xx=font.em_size[0], yy=font.em_size[1]))


def context_show_text_glyphs(context: cairo.Context, font: Font, glyphs: Sequence[Glyph]):
    ox, oy = context.get_current_point()
    cairo_glyphs = []
    cairo_clusters = []

    g_x, g_y = ox, oy
    for glyph in glyphs:
        cairo_clusters.append(
            cairo.TextCluster(len(glyph.cluster.encode("utf8")), len(glyph.cluster))
        )
        cairo_glyphs.append(cairo.Glyph(glyph.index, g_x + glyph.x_offset, g_y + glyph.y_offset))
        g_x += glyph.x_advance
        g_y += glyph.y_advance

    context_set_font(context, font)
    context.show_text_glyphs("".join(g.cluster for g in glyphs), cairo_glyphs, cairo_clusters, 0)
    context.move_to(g_x, g_y)
