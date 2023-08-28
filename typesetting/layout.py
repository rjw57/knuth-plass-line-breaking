import dataclasses
import enum
import math
from collections import namedtuple
from typing import TYPE_CHECKING, Generator, Iterable

import uniseg.linebreak

from .hyphenation import SOFT_HYPHEN

if TYPE_CHECKING:
    from .font import Font

__all__ = [
    "ParagraphItemType",
    "ParagraphItem",
    "text_to_paragraph_items",
    "MAX_PENALTY",
    "paragraph_item_running_sums",
    "greedy_line_breaks",
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
                text=" ",
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


RunningSum = namedtuple("RunningSum", ["width", "shrinkability", "stretchability"])


def paragraph_item_running_sums(
    para_items: Iterable[ParagraphItem],
) -> Generator[RunningSum, None, None]:
    previous_sum = RunningSum(0, 0, 0)
    yield previous_sum
    for item in para_items:
        if item.item_type != ParagraphItemType.PENALTY:
            previous_sum = RunningSum(
                width=previous_sum.width + item.width,
                shrinkability=previous_sum.shrinkability + item.shrinkability,
                stretchability=previous_sum.stretchability + item.stretchability,
            )
        yield previous_sum


def greedy_line_breaks(
    para_items: Iterable[ParagraphItem], width: float
) -> Generator[int, None, None]:
    "Return sequence of indices in para_items for line breaks."
    sums = list(paragraph_item_running_sums(para_items))
    current_start_idx = 0
    for item_idx, item in enumerate(para_items):
        # Don't break lines at boxes.
        if item.item_type == ParagraphItemType.BOX:
            continue

        # Forced break
        if item.penalty <= -MAX_PENALTY:
            yield item_idx
            current_start_idx = item_idx + 1
            continue

        # Compute natural width and total stretch/shrinkability
        line_width = sums[item_idx].width - sums[current_start_idx].width
        if item.item_type == ParagraphItemType.PENALTY:
            line_width += item.width
        line_stretchability = (
            sums[item_idx].stretchability - sums[current_start_idx].stretchability
        )

        if line_width + line_stretchability < width:
            continue

        yield item_idx
        current_start_idx = item_idx + 1
