import dataclasses
import enum
import math
from typing import TYPE_CHECKING, Generator

import uniseg.linebreak

from ..hyphenation import SOFT_HYPHEN

if TYPE_CHECKING:
    from .font import Font

__all__ = [
    "ParagraphItemType",
    "ParagraphItem",
    "text_to_paragraph_items",
    "MAX_PENALTY",
]


class ParagraphItemType(enum.Enum):
    BOX = enum.auto()
    GLUE = enum.auto()
    PENALTY = enum.auto()


@dataclasses.dataclass(frozen=True, eq=True)
class ParagraphItem:
    item_type: ParagraphItemType
    width: float = 0.0
    stretchability: float = 0.0
    shrinkability: float = 0.0
    penalty: float = 0.0
    flagged: bool = False
    text: str = ""


SOFT_HYPHEN_PENALTY = 50
MAX_PENALTY = math.inf  # penalties behyong this are viewed as "infinite".
MAX_STRETCH = 100000


def _text_width(text: str, font: "Font") -> float:
    return sum(g.x_advance for g in font.shape(text))


def text_to_paragraph_items(text: str, font: "Font") -> Generator[ParagraphItem, None, None]:
    space_width = _text_width(" ", font)
    hyphen_width = _text_width("-", font)

    running_width: float = 0.0
    running_stems: list[str] = []
    for lb_item in uniseg.linebreak.line_break_units(text):
        stem = lb_item.rstrip(f" {SOFT_HYPHEN}\n")
        if len(stem) > 0:
            running_stems.append(stem)
            stem_width = _text_width("".join(running_stems), font) - running_width
            running_width += stem_width
            yield ParagraphItem(
                item_type=ParagraphItemType.BOX,
                width=stem_width,
                text=stem,
            )
        else:
            running_stems, running_width = [], 0.0

        if lb_item.endswith(SOFT_HYPHEN):
            yield ParagraphItem(
                item_type=ParagraphItemType.PENALTY,
                width=hyphen_width,
                penalty=SOFT_HYPHEN_PENALTY,
                flagged=True,
                text="-",
            )
        elif lb_item.endswith("\n"):
            yield ParagraphItem(
                item_type=ParagraphItemType.GLUE,
                stretchability=MAX_STRETCH,
            )
            yield ParagraphItem(
                item_type=ParagraphItemType.PENALTY,
                penalty=-MAX_PENALTY,
                flagged=True,
            )
        elif lb_item.endswith(" "):
            yield ParagraphItem(
                item_type=ParagraphItemType.GLUE,
                width=space_width,
                shrinkability=0.3 * space_width,
                stretchability=0.5 * space_width,
            )

    # Add finishing glue and forced break
    yield ParagraphItem(
        item_type=ParagraphItemType.GLUE,
        stretchability=MAX_STRETCH,
    )
    yield ParagraphItem(
        item_type=ParagraphItemType.PENALTY,
        penalty=-MAX_PENALTY,
        flagged=True,
    )
