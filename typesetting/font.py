import dataclasses
import typing
from collections.abc import Generator

import freetype
import uniseg.graphemecluster
import uharfbuzz as hb

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
    harfbuzz_font: hb.Font = dataclasses.field(init=False)

    def __post_init__(self):
        object.__setattr__(self, "freetype_face", freetype.Face(self.path))
        self.freetype_face.set_char_size(
            int(self.em_size[0] * 64),
            int(self.em_size[1] * 64),
            self.dpi[0],
            self.dpi[1],
        )

        blob = hb.Blob.from_file_path(self.path)
        face = hb.Face(blob)
        object.__setattr__(self, "harfbuzz_font", hb.Font(face))
        self.harfbuzz_font.ptem = self.em_size[1]
        self.harfbuzz_font.ppem = tuple(self.em_size[i] * self.dpi[i] / 72.0 for i in range(2))

    def shape(self, text: str) -> Generator["Glyph", None, None]:
        # Split text into grapheme clusters.
        clusters_by_idx, cluster_code_point_indices_by_idx = {}, {}
        idx, cp_idx = 0, 0
        for cluster in uniseg.graphemecluster.grapheme_clusters(text):
            clusters_by_idx[idx] = cluster
            cluster_code_point_indices_by_idx[idx] = cp_idx
            idx += len(cluster.encode("utf8"))
            cp_idx += len(cluster)

        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()

        hb.shape(self.harfbuzz_font, buf, {f: True for f in self.features})
        infos = buf.glyph_infos
        positions = buf.glyph_positions

        for info, pos in zip(infos, positions):
            yield Glyph(
                index=info.codepoint,
                cluster=clusters_by_idx[info.cluster],
                cluster_code_point_index=cluster_code_point_indices_by_idx[info.cluster],
                x_advance=pos.x_advance * 1e-3 * self.em_size[0],
                y_advance=pos.y_advance * 1e-3 * self.em_size[1],
                x_offset=pos.x_offset * 1e-3 * self.em_size[0],
                y_offset=pos.y_offset * 1e-3 * self.em_size[1],
            )

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
