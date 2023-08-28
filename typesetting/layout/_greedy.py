from typing import Generator, Iterable

from ._types import MAX_PENALTY, ParagraphItem, ParagraphItemType

__all__ = ["greedy_line_breaks"]


def greedy_line_breaks(
    para_items: Iterable[ParagraphItem], width: float
) -> Generator[int, None, None]:
    "Return sequence of indices in para_items for line breaks."
    feasible_break_idx_and_items = []
    prev_was_box = False
    sum_widths = [0.0]
    for item_idx, item in enumerate(para_items):
        if item.item_type != ParagraphItemType.PENALTY:
            sum_widths.append(sum_widths[-1] + item.width)
        else:
            sum_widths.append(sum_widths[-1])

        if item.item_type == ParagraphItemType.PENALTY and item.penalty < MAX_PENALTY:
            feasible_break_idx_and_items.append((item_idx, item))
        elif item.item_type == ParagraphItemType.GLUE and prev_was_box:
            feasible_break_idx_and_items.append((item_idx, item))

        prev_was_box = item.item_type == ParagraphItemType.BOX

    current_start_idx = 0
    for break_idx, (item_idx, item) in enumerate(feasible_break_idx_and_items):
        if item.penalty <= -MAX_PENALTY:
            # forced break
            yield item_idx
            current_start_idx = item_idx + 1
        elif break_idx < len(feasible_break_idx_and_items) - 1:
            next_item_idx, next_item = feasible_break_idx_and_items[break_idx + 1]
            natural_width = sum_widths[next_item_idx] - sum_widths[current_start_idx]
            if next_item.item_type == ParagraphItemType.PENALTY:
                natural_width += next_item.width
            if natural_width > width:
                yield item_idx
                current_start_idx = item_idx + 1
