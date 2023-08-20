import dataclasses
import enum

__all__ = ["ParagraphItemType", "ParagraphItem"]


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
