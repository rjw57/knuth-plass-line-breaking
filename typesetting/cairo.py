from typing import Iterable, Sequence

import cairo
import uharfbuzz as hb

from ._cairofontface import create_cairo_font_face_for_ft_face
from .font import Font, Glyph

__all__ = ["fill_glyphs_at"]


def make_hb_cairo_drawfuncs():
    drawfuncs = hb.DrawFuncs()

    def move_to(x: float, y: float, ctx: cairo.Context):
        ctx.move_to(x, y)

    drawfuncs.set_move_to_func(move_to)

    def line_to(x: float, y: float, ctx: cairo.Content):
        ctx.line_to(x, y)

    drawfuncs.set_line_to_func(line_to)

    def cubic_to(
        x1: float, y1: float, x2: float, y2: float, x3: float, y3: float, ctx: cairo.Context
    ):
        ctx.curve_to(x1, y1, x2, y2, x3, y3)

    drawfuncs.set_cubic_to_func(cubic_to)

    def quadratic_to(x1: float, y1: float, x2: float, y2: float, ctx: cairo.Context):
        x0, y0 = ctx.get_current_point()
        ctx.curve_to(
            2.0 / 3.0 * x1 + 1.0 / 3.0 * x0,
            2.0 / 3.0 * y1 + 1.0 / 3.0 * y0,
            2.0 / 3.0 * x1 + 1.0 / 3.0 * x2,
            2.0 / 3.0 * y1 + 1.0 / 3.0 * y2,
            x2,
            y2,
        )

    drawfuncs.set_quadratic_to_func(quadratic_to)

    def close_path(ctx: cairo.Context):
        ctx.close_path()

    drawfuncs.set_close_path_func(close_path)

    return drawfuncs


hb_cairo_drawfuncs = make_hb_cairo_drawfuncs()


def glyph_at(ctx: cairo.Context, x: float, y: float, glyph: Glyph, font: Font):
    ctx.save()
    ctx.translate(x, y)
    ctx.translate(glyph.x_offset, glyph.y_offset)
    ctx.scale(font.em_size[0] * 1e-3, -font.em_size[1] * 1e-3)
    font.harfbuzz_font.draw_glyph(glyph.index, hb_cairo_drawfuncs, ctx)
    ctx.restore()


def fill_glyphs_at(ctx: cairo.Context, x: float, y: float, glyphs: Iterable[Glyph], font: Font):
    ctx.save()
    ctx.set_fill_rule(cairo.FILL_RULE_WINDING)
    for glyph in glyphs:
        glyph_at(ctx, x, y, glyph, font)
        x += glyph.x_advance
        y += glyph.y_advance
        ctx.fill()
    ctx.restore()


def context_set_font(context: cairo.Context, font: Font):
    context.set_font_face(create_cairo_font_face_for_ft_face(context, font.freetype_face._FT_Face))
    context.set_font_matrix(cairo.Matrix(xx=font.em_size[0], yy=font.em_size[1]))


def context_show_text_glyphs(context: cairo.Context, font: Font, glyphs: Sequence[Glyph]):
    cairo_glyphs = []
    cairo_clusters = []

    g_x, g_y = context.get_current_point()
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
