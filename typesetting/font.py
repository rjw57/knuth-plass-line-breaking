import dataclasses
import typing
from typing import Sequence

import freetype
import uniseg.graphemecluster

from ._raqm import Raqm

__all__ = ["Font", "Glyph"]


@dataclasses.dataclass(frozen=True)
class Font:
    """
    Representation of a given font backed by a FreeType face.

    """

    path: str
    em_size: tuple[float, float]  # In points
    dpi: tuple[int, int] = (72, 72)
    features: typing.Sequence[str] = ()
    language: str = "en"
    freetype_face: freetype.Face = dataclasses.field(init=False)

    def __post_init__(self):
        object.__setattr__(self, "freetype_face", freetype.Face(self.path))
        self.freetype_face.set_char_size(
            int(self.em_size[0] * 64),
            int(self.em_size[1] * 64),
            self.dpi[0],
            self.dpi[1],
        )

    def shape(self, text: str) -> Sequence["Glyph"]:
        # Split text into grapheme clusters.
        clusters_by_idx, cluster_code_point_indices_by_idx = {}, {}
        idx, cp_idx = 0, 0
        for cluster in uniseg.graphemecluster.grapheme_clusters(text):
            clusters_by_idx[idx] = cluster
            cluster_code_point_indices_by_idx[idx] = cp_idx
            idx += len(cluster.encode("utf8"))
            cp_idx += len(cluster)

        # Layout text.
        r = Raqm()
        assert r.set_text_utf8(text.encode("utf8"))
        assert r.set_freetype_face(self.freetype_face)
        for f in self.features:
            assert r.add_font_feature(f)
        assert r.layout()

        # Return gyphs and clusters for that glyph.
        return [
            Glyph(
                index=g.index,
                cluster=clusters_by_idx[g.cluster],
                cluster_code_point_index=cluster_code_point_indices_by_idx[g.cluster],
                x_advance=g.x_advance / 64.0,
                y_advance=g.y_advance / 64.0,
                x_offset=g.x_offset / 64.0,
                y_offset=g.y_offset / 64.0,
            )
            for g in r.get_glyphs() or []
        ]

    @property
    def ascender(self):
        "Font ascender in points."
        return self.freetype_face.ascender / self.freetype_face.units_per_EM * self.em_size[1]

    @property
    def descender(self):
        "Font descender in points."
        return self.freetype_face.descender / self.freetype_face.units_per_EM * self.em_size[1]


@dataclasses.dataclass(frozen=True)
class Glyph:
    index: int
    cluster: str
    cluster_code_point_index: int

    # {x,y}_{advance,offset} are in device units
    x_advance: float
    y_advance: float
    x_offset: float
    y_offset: float
