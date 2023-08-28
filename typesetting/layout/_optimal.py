import dataclasses
import enum
import math
from typing import Generator, Iterable, Optional

from sortedcontainers import SortedDict

from ._types import MAX_PENALTY, ParagraphItem, ParagraphItemType

__all__ = ["OptimiserParameters", "optimal_line_breaks"]


class FitnessClass(enum.IntEnum):
    TIGHT = 0
    NORMAL = 1
    LOOSE = 2
    VERY_LOOSE = 3


@dataclasses.dataclass(frozen=True, eq=True)
class RunningSum:
    "Running sums of line widths, stretch and shrink."
    width: float = 0.0
    stretch: float = 0.0
    shrink: float = 0.0


@dataclasses.dataclass(frozen=True, eq=True)
class BreakPoint:
    "Record of a break point."
    # Index of paragraph item at break point and the item itself. An index of -1 and an item of
    # None corresponds to the start of the paragraph.
    item_idx: int
    item: ParagraphItem

    # Running sums up to this break point.
    running_sum: RunningSum


@dataclasses.dataclass(frozen=True, eq=True, order=True)
class NodeKey:
    "Unique key for search node."

    # Index of line this break appears on. -1 == start of para
    line_idx: int = -1

    # Index of para item corresponding to this line break. None == start of para
    item_idx: Optional[int] = None

    # Fitness class of this line.
    fitness_class: FitnessClass = FitnessClass.NORMAL


@dataclasses.dataclass(frozen=True, eq=True)
class NodeData:
    "Data associated with a particular path to a search node."

    # The break point itself. If None, this node represents a virtual break which starts the
    # paragraph.
    break_point: Optional[BreakPoint] = None

    # Total demerits along this path.
    total_demerits: float = 0.0

    # Previous node key and data along the path.
    previous: Optional[tuple[NodeKey, "NodeData"]] = None


@dataclasses.dataclass(frozen=True, eq=True)
class OptimiserParameters:
    "Parameters for optimisation algorithm."

    # Maximum adjustment ratio for a break to be considered "feasible".
    upper_adjustment_ratio: float = 4.0

    # Extra penalty added for two flagged breaks in a row.
    extra_flag_penalty: float = 50

    # Fixed penalty added to all line breaks.
    line_penalty: float = 10

    # Penalty added for each unit of mismatched fitness class.
    mismatched_fitness_penalty: float = 10


def adjustment_ratio_for_line(
    prev_sums: RunningSum, break_point: BreakPoint, width: float
) -> float:
    # Compute natural width of line.
    natural_width = break_point.running_sum.width - prev_sums.width
    if break_point.item.item_type == ParagraphItemType.PENALTY:
        natural_width += break_point.item.width

    # Compute adjustment ratio implied by line.
    if natural_width < width:
        line_stretch = break_point.running_sum.stretch - prev_sums.stretch
        return (width - natural_width) / line_stretch if line_stretch > 0 else math.inf
    elif natural_width > width:
        line_shrink = break_point.running_sum.shrink - prev_sums.shrink
        return (width - natural_width) / line_shrink if line_shrink > 0 else math.inf

    return 0.0


def fitness_class_for_adjustment_ratio(adjustment_ratio: float) -> FitnessClass:
    if adjustment_ratio < -0.5:
        return FitnessClass.TIGHT
    elif adjustment_ratio < 0.5:
        return FitnessClass.NORMAL
    elif adjustment_ratio < 1.0:
        return FitnessClass.LOOSE
    else:
        return FitnessClass.VERY_LOOSE


def line_demerit(
    params: OptimiserParameters,
    prev_break_point: Optional[BreakPoint],
    break_point: BreakPoint,
    adjustment_ratio: float,
    prev_fitness_class: FitnessClass,
    fitness_class: FitnessClass,
) -> float:
    # Start with the base item penalty.
    penalty = break_point.item.penalty

    is_forced_break = penalty <= -MAX_PENALTY

    # If the previous line break was flagged and this line break
    # was flagged, add an additional penalty.
    if prev_break_point is not None:
        if break_point.item.flagged and prev_break_point.item.flagged:
            penalty += params.extra_flag_penalty

    # If we move more than 1 step of fitness class, add penalty.
    penalty += params.mismatched_fitness_penalty * abs(fitness_class - prev_fitness_class)

    # Add a fixed penalty for breaking lines.
    penalty += params.line_penalty

    # Compute demerit for this line.
    if is_forced_break:
        return (1.0 + 100.0 * (abs(adjustment_ratio) ** 3.0)) ** 2.0
    elif penalty >= 0.0:
        return (1.0 + 100.0 * (abs(adjustment_ratio) ** 3.0) + penalty) ** 2.0
    else:
        return (1.0 + 100.0 * (abs(adjustment_ratio) ** 3.0)) ** 2.0 - (penalty**2.0)


def potential_breaks(para_items: Iterable[ParagraphItem]) -> Generator[BreakPoint, None, None]:
    prev_was_box = False
    total_width, total_stretch, total_shrink = 0.0, 0.0, 0.0

    for item_idx, item in enumerate(para_items):
        # Determine if this is a potential breakpoint.
        is_potential_breakpoint = False
        if item.item_type == ParagraphItemType.GLUE:
            is_potential_breakpoint = prev_was_box
        elif item.item_type == ParagraphItemType.PENALTY:
            is_potential_breakpoint = item.penalty < MAX_PENALTY

        if is_potential_breakpoint:
            yield BreakPoint(
                item_idx=item_idx,
                item=item,
                running_sum=RunningSum(
                    width=total_width,
                    stretch=total_stretch,
                    shrink=total_shrink,
                ),
            )

        # Update running totals
        if item.item_type != ParagraphItemType.PENALTY:
            total_width += item.width
        if item.item_type == ParagraphItemType.GLUE:
            total_stretch += item.stretchability
            total_shrink += item.shrinkability

        # Update flag indicating if the previous item was a box.
        prev_was_box = item.item_type == ParagraphItemType.BOX


def optimal_line_breaks(
    para_items: Iterable[ParagraphItem], width: float, params: Optional[OptimiserParameters] = None
) -> Generator[int, None, None]:
    params = params if params is not None else OptimiserParameters()
    active_nodes: SortedDict[NodeKey, NodeData] = SortedDict()

    # Add an active node corresponding to the start of the paragraph.
    active_nodes[NodeKey()] = NodeData()

    for break_point in potential_breaks(para_items):
        feasible_breaks: set[tuple[NodeKey, NodeData]] = set()
        nodes_to_deactivate: set[NodeKey] = set()

        for node_key, node_data in active_nodes.items():
            prev_running_sum = (
                node_data.break_point.running_sum
                if node_data.break_point is not None
                else RunningSum()
            )
            adjustment_ratio = adjustment_ratio_for_line(prev_running_sum, break_point, width)
            fitness_class = fitness_class_for_adjustment_ratio(adjustment_ratio)

            # Deactivate nodes where we're considering endpoints so far away that glue would have
            # to be shrunken too far or if this breakpoint is a forced breakpoint and so later
            # lines could never start at the node.
            if adjustment_ratio < -1.0 or break_point.item.penalty <= -MAX_PENALTY:
                nodes_to_deactivate.add(node_key)

                # If this would remove all active nodes, make sure we record the next break as
                # feasible. This is a "break of last resort" to make sure we find _some_ solution.
                if len(nodes_to_deactivate) == len(active_nodes):
                    adjustment_ratio = -1.0

            # Compute additional demerit if we were to break here.
            demerit = line_demerit(
                params,
                node_data.break_point,
                break_point,
                adjustment_ratio,
                fitness_class,
                node_key.fitness_class,
            )

            # Compute total demerits from breaking here.
            total_demerits = demerit + node_data.total_demerits

            break_node_key = NodeKey(
                line_idx=node_key.line_idx + 1,
                item_idx=break_point.item_idx,
                fitness_class=fitness_class,
            )
            break_node_data = NodeData(
                break_point=break_point,
                total_demerits=total_demerits,
                previous=(node_key, node_data),
            )

            # If this line is not stretched or shrunk too much, record it as a feasible breakpoint.
            if adjustment_ratio >= -1.0 and adjustment_ratio < params.upper_adjustment_ratio:
                feasible_breaks.add((break_node_key, break_node_data))

        # Deactivate nodes we no-longer need.
        for nk in nodes_to_deactivate:
            del active_nodes[nk]

        # Activate best feasible breaks.
        for nk, nd in feasible_breaks:
            existing_data = active_nodes.get(nk)
            if existing_data is None or existing_data.total_demerits > nd.total_demerits:
                active_nodes[nk] = nd

    # Find the optimal remaining active node.
    assert len(active_nodes) > 0
    node: Optional[tuple[NodeKey, NodeData]] = None
    for nk, nd in active_nodes.items():
        if node is None or nd.total_demerits < node[1].total_demerits:
            node = (nk, nd)
    assert node is not None

    # Find best path.
    optimal_line_break_idxs = []
    while node is not None:
        nk, nd = node
        if nk.item_idx is not None:
            optimal_line_break_idxs.append(nk.item_idx)
        node = nd.previous

    yield from reversed(optimal_line_break_idxs)
