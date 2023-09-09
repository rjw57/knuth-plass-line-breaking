import { createIntlSegmenterPolyfill } from "intl-segmenter-polyfill/dist/bundled";

const MAX_STRETCH = 100000;

const MAX_PENALTY = Infinity;
const HYPHEN_PENALTY = 10.0;
const LINE_PENALTY = 10.0;

export interface Font {
  measureText: (text: string) => number;
}

export interface Box {
  type: "box";
  width: number;
  text: string;
  font: Font;
}

export interface Glue {
  type: "glue";
  width: number;
  penalty: number;
  stretchability: number;
  shrinkability: number;
}

export interface Penalty {
  type: "penalty";
  width: number;
  penalty: number;
  flagged: boolean;
  text?: string;
  font?: Font;
}

export type ParagraphItem = Box | Glue | Penalty;

export interface ParagraphInitialItemsOptions {
  indentWidth?: number;
}

export function* paragraphInitialItems(options?: ParagraphInitialItemsOptions): Generator<ParagraphItem> {
  const { indentWidth } = { indentWidth: 0, ...options };

  // Starting glue
  yield {
    type: "glue",
    width: indentWidth,
    penalty: MAX_PENALTY,
    stretchability: 0.0,
    shrinkability: 0.0,
  };
}

export function* paragraphFinalItems(): Generator<ParagraphItem> {
  // Finishing glue and forced line break.
  yield {
    type: "glue",
    width: 0.0,
    penalty: MAX_PENALTY,
    stretchability: MAX_STRETCH,
    shrinkability: 0.0,
  };
  yield { type: "penalty", width: 0.0, penalty: -MAX_PENALTY, flagged: true };
}

export function* paragraphItemsForText(
  text: string,
  font: Font,
  sentenceSegmenter: Intl.Segmenter,
  wordSegmenter: Intl.Segmenter,
): Generator<ParagraphItem> {
  const spaceWidth = font.measureText(" ");
  const overhangingPunctuationWidth = 0.5 * spaceWidth;
  const hyphenWidth = font.measureText("-") - overhangingPunctuationWidth;

  for (const { segment: sentence } of sentenceSegmenter.segment(text)) {
    let prevWasPunctuation = false;
    for (const { segment: word, index: wordIndex } of wordSegmenter.segment(sentence)) {
      const isPunctuation = !!word.match(/^\p{P}$/u);
      const isFinalWord = wordIndex + word.length >= sentence.length;

      let extraWidth = prevWasPunctuation ? overhangingPunctuationWidth : 0.0;

      if (word.match(/^\s$/)) {
        // Turn spaces into glue.
        const width = spaceWidth;
        const penalty = word === "\u00A0" ? MAX_PENALTY : LINE_PENALTY;
        yield {
          type: "glue",
          width: width + extraWidth + (isFinalWord ? spaceWidth : 0.0),
          penalty: penalty,
          stretchability: 0.5 * width,
          shrinkability: 0.3 * width,
        };
      } else {
        // All other text becomes boxes.
        const syllables = word.split("\u00AD");
        for (let syllableIdx = 0; syllableIdx < syllables.length; syllableIdx++) {
          const syllable = syllables[syllableIdx];
          let width = font.measureText(syllable);
          if (syllableIdx === 0) {
            width += extraWidth;
          }
          if (syllableIdx === syllables.length - 1 && isPunctuation) {
            width -= overhangingPunctuationWidth;
          }
          yield {
            type: "box",
            width,
            text: syllable,
            font,
          };
          if (syllableIdx !== syllables.length - 1) {
            yield {
              type: "penalty",
              penalty: HYPHEN_PENALTY,
              width: hyphenWidth,
              flagged: true,
              text: "-",
              font,
            };
          }
        }
      }
      prevWasPunctuation = isPunctuation;
    }
  }
}

interface RunningSum {
  width: number;
  stretch: number;
  shrink: number;
}

interface BreakPoint {
  item: ParagraphItem;
  itemIndex: number;
  runningSum: RunningSum; // up to but not including this item
}

function* potentialBreakPoints(paraItems: ArrayLike<ParagraphItem>): Generator<BreakPoint> {
  let previousItemWasBox = false,
    width = 0.0,
    stretch = 0.0,
    shrink = 0.0;

  for (let itemIndex = 0; itemIndex < paraItems.length; itemIndex++) {
    const item = paraItems[itemIndex];
    let isPotentialBreak = false;
    if (item.type === "glue") {
      isPotentialBreak = previousItemWasBox && item.penalty < MAX_PENALTY;
    } else if (item.type === "penalty") {
      isPotentialBreak = item.penalty < MAX_PENALTY;
    }

    if (isPotentialBreak) {
      yield {
        item,
        itemIndex,
        runningSum: { width, shrink, stretch },
      };
    }

    if (item.type !== "penalty") {
      width += item.width;
    }
    if (item.type === "glue") {
      stretch += item.stretchability;
      shrink += item.shrinkability;
    }

    previousItemWasBox = item.type === "box";
  }
}

export interface Line {
  startIndex: number; // inclusive
  endIndex: number; // exclusive
  adjustmentRatio: number;
  naturalWidth: number;
  isOverfull: boolean;
  isUnderfull: boolean;
}

export function* greedyBreaks(
  paraItems: ArrayLike<ParagraphItem>,
  lineWidth: number,
): Generator<Line> {
  let previousLineEndItemIndex = -1,
    previousLineRunningSum: RunningSum = { width: 0.0, stretch: 0.0, shrink: 0.0 };
  let previousBreak: BreakPoint | null = null,
    previousBreakNaturalWidth = 0.0,
    previousBreakAdjustmentRatio = 0.0;

  for (const breakPoint of potentialBreakPoints(paraItems)) {
    let naturalWidth = breakPoint.runningSum.width - previousLineRunningSum.width;
    if (breakPoint.item.type === "penalty") {
      naturalWidth += breakPoint.item.width;
    }

    let adjustmentRatio = 0.0;
    if (naturalWidth < lineWidth) {
      const lineStretch = breakPoint.runningSum.stretch - previousLineRunningSum.stretch;
      adjustmentRatio = lineStretch > 0 ? (lineWidth - naturalWidth) / lineStretch : Infinity;
    } else if (naturalWidth > lineWidth) {
      const lineShrink = breakPoint.runningSum.shrink - previousLineRunningSum.shrink;
      adjustmentRatio = lineShrink > 0 ? (lineWidth - naturalWidth) / lineShrink : Infinity;
    }

    if (naturalWidth > lineWidth && previousBreak) {
      yield {
        startIndex: previousLineEndItemIndex + 1,
        endIndex: previousBreak.itemIndex + 1,
        adjustmentRatio: previousBreakAdjustmentRatio,
        naturalWidth: previousBreakNaturalWidth,
        isOverfull: previousBreakAdjustmentRatio < -1.0,
        isUnderfull: false,
      };
      previousLineEndItemIndex = previousBreak.itemIndex;
      previousLineRunningSum = { ...previousBreak.runningSum };

      // If we broke at a glue, we need to include the glue's width and shrink/stretch in the
      // running sum so that later lines calculate their natural width, etc correctly.
      if (previousBreak.item.type === "glue") {
        previousLineRunningSum.width += previousBreak.item.width;
        previousLineRunningSum.stretch += previousBreak.item.stretchability;
        previousLineRunningSum.shrink += previousBreak.item.shrinkability;
      }
    }

    if (breakPoint.item.type === "penalty" && breakPoint.item.penalty <= -MAX_PENALTY) {
      // This is a forced break.
      yield {
        startIndex: previousLineEndItemIndex + 1,
        endIndex: breakPoint.itemIndex + 1,
        adjustmentRatio: 0.0,
        naturalWidth: 0.0, // TODO: actually calculate this
        isOverfull: false,
        isUnderfull: false,
      };
      previousLineEndItemIndex = breakPoint.itemIndex;
      // No need to add width here because break point is definitely a penalty and should
      // not be included in the running sum.
      previousLineRunningSum = breakPoint.runningSum;
    }

    previousBreak = breakPoint;
    previousBreakNaturalWidth = naturalWidth;
    previousBreakAdjustmentRatio = adjustmentRatio;
  }
}

interface OptimiserParameters {
  upperAdjustmentRatio?: number;
  extraFlagPenalty?: number;
  mismatchedFitnessPenalty?: number;
  emergencyStretch?: number;
  allowOverfull?: boolean;
  looseness?: number;
}

const DEFAULT_OPTIMISER_PARAMETERS = {
  upperAdjustmentRatio: 4.0,
  extraFlagPenalty: 50.0,
  mismatchedFitnessPenalty: 10.0,
  emergencyStretch: 0.0,
  allowOverfull: false,
  looseness: 0.0,
};

interface Node {
  lineIndex: number;
  fitnessClass: number;
  naturalWidth: number;
  adjustmentRatio: number;
  isOverfull: boolean;
  isUnderfull: boolean;
  breakPoint?: BreakPoint;
  totalDemerit: number;
  previous?: Node;
  link?: Node;
}

const fitnessClassForAdjustmentRatio = (adjustmentRatio: number): number => {
  if (adjustmentRatio < -0.5) {
    return 0; // tight
  } else if (adjustmentRatio < 0.5) {
    return 1; // normal
  } else if (adjustmentRatio < 1.0) {
    return 2; // loose
  }
  return 3; // very loose
};

const cube = (x: number) => x * x * x;
const square = (x: number) => x * x;

export function* optimalBreaks(
  paraItems: ArrayLike<ParagraphItem>,
  lineWidth: number,
  parameters?: OptimiserParameters,
): Generator<Line> {
  const {
    upperAdjustmentRatio,
    mismatchedFitnessPenalty,
    extraFlagPenalty,
    emergencyStretch,
    allowOverfull,
    looseness,
  } = {
    ...DEFAULT_OPTIMISER_PARAMETERS,
    ...parameters,
  };
  const initialRunningSum = { width: 0.0, stretch: 0.0, shrink: 0.0 };

  // Add an initial node representing the start of the paragraph.
  let firstActiveNode: Node | undefined = {
    lineIndex: -1,
    fitnessClass: 1,
    totalDemerit: 0.0,
    adjustmentRatio: 0.0,
    naturalWidth: 0.0,
    isOverfull: false,
    isUnderfull: false,
  };
  const deactivatedNodes: Node[] = [];

  for (const breakPoint of potentialBreakPoints(paraItems)) {
    if (breakPoint.item.type === "box") {
      throw new Error("Unexpected box used as break.");
    }
    const breakIsPenalty = breakPoint.item.type === "penalty";
    const isForcedBreak = breakIsPenalty && breakPoint.item.penalty <= -MAX_PENALTY;

    // Best nodes for each fitness class and line index.
    const minimalDemerits = new Map<string, Node>();

    // Make array copy since we may be modifying the active node list.
    let prevNode: Node | undefined;
    for (let node: Node | undefined = firstActiveNode; node; node = node.link) {
      const nextNode: Node | undefined = node?.link;

      // Get the node's running sum and calculate the "natural" width of a line from the node to
      // this breakpoint.
      const nodeRunningSum = { ...(node.breakPoint?.runningSum ?? initialRunningSum) };

      // If the previous line ended on glue, we need to make sure we account for its width as it
      // won't be in the node's running sum.
      if (node.breakPoint && node.breakPoint.item.type === "glue") {
        nodeRunningSum.width += node.breakPoint.item.width;
        nodeRunningSum.stretch += node.breakPoint.item.stretchability;
        nodeRunningSum.shrink += node.breakPoint.item.shrinkability;
      }

      let naturalWidth = breakPoint.runningSum.width - nodeRunningSum.width;
      if (breakIsPenalty) {
        naturalWidth += breakPoint.item.width;
      }

      // Compute the adjustment ratio for the line between the node and the current breakpoint.
      let adjustmentRatio = 0.0,
        actualAdjustmentRatio = 0.0;
      if (naturalWidth < lineWidth) {
        let lineStretch = breakPoint.runningSum.stretch - nodeRunningSum.stretch;
        actualAdjustmentRatio =
          lineStretch > 0 ? (lineWidth - naturalWidth) / lineStretch : Infinity;
        lineStretch += emergencyStretch;
        adjustmentRatio = lineStretch > 0 ? (lineWidth - naturalWidth) / lineStretch : Infinity;
      } else if (naturalWidth > lineWidth) {
        const lineShrink = breakPoint.runningSum.shrink - nodeRunningSum.shrink;
        adjustmentRatio = actualAdjustmentRatio =
          lineShrink > 0 ? (lineWidth - naturalWidth) / lineShrink : -Infinity;
      }

      const isOverfull = adjustmentRatio < -1.0;

      // Deactivate nodes where we're considering endpoints so far away that glue would have to be
      // shrunken too far or if this breakpoint is a forced breakpoint and so later lines could
      // never start at the node.
      if (adjustmentRatio < -1.0 || isForcedBreak) {
        deactivatedNodes.push(node);
        if (prevNode) {
          prevNode.link = nextNode;
        } else {
          firstActiveNode = nextNode;
        }

        // If this removes all active nodes, make sure we record the next break as feasible. This
        // is a "break of last resort" to make sure we find _some_ solution.
        if (!firstActiveNode && allowOverfull) {
          adjustmentRatio = -1.0;
        }
      } else {
        prevNode = node;
      }

      // If this line is not stretched or shrunk too much, record it as a feasible breakpoint.
      if (adjustmentRatio >= -1.0 && adjustmentRatio <= upperAdjustmentRatio) {
        // Compute fitness class for this line.
        const fitnessClass = fitnessClassForAdjustmentRatio(adjustmentRatio);

        let lineDemerit;
        if (breakPoint.item.penalty <= -MAX_PENALTY) {
          // Forced breakpoint
          lineDemerit = square(1.0 + 100.0 * cube(Math.abs(adjustmentRatio)));
        } else {
          let itemPenalty = breakPoint.item.penalty;

          // If the previous line break was flagged and this line break was flagged, add an
          // additional penalty.
          const nodeFlagged =
            node.breakPoint &&
            node.breakPoint.item.type === "penalty" &&
            node.breakPoint.item.flagged;
          const breakFlagged = breakPoint.item.type === "penalty" && breakPoint.item.flagged;
          if (nodeFlagged && breakFlagged) {
            itemPenalty += extraFlagPenalty;
          }

          // If we move more than 1 step of fitness class, add penalty.
          const fitnessDelta = Math.abs(fitnessClass - node.fitnessClass);
          if (fitnessDelta > 1) {
            itemPenalty += mismatchedFitnessPenalty;
          }

          if (itemPenalty >= 0.0) {
            lineDemerit = square(1.0 + 100.0 * cube(Math.abs(adjustmentRatio)) + itemPenalty);
          } else {
            lineDemerit =
              square(1.0 + 100.0 * cube(Math.abs(adjustmentRatio))) - square(itemPenalty);
          }
        }

        // Record this break if it is more optimal than an existing one or if there is no current
        // break recorded.
        const totalDemerit = node.totalDemerit + lineDemerit;
        const key = `${node.lineIndex + 1}-${fitnessClass}`;
        const previousBestNode = minimalDemerits.get(key);
        if (!previousBestNode || previousBestNode.totalDemerit > totalDemerit) {
          minimalDemerits.set(key, {
            lineIndex: node.lineIndex + 1,
            breakPoint,
            fitnessClass,
            totalDemerit: node.totalDemerit + lineDemerit,
            previous: node,
            naturalWidth,
            adjustmentRatio,
            isOverfull,
            isUnderfull: actualAdjustmentRatio !== adjustmentRatio,
          });
        }
      }
    }

    for (const node of minimalDemerits.values()) {
      if (node) {
        firstActiveNode = { ...node, link: firstActiveNode };
      }
    }
  }

  let optimalNode: Node | undefined;
  for (let node = firstActiveNode; node; node = node.link) {
    if (!optimalNode || optimalNode.totalDemerit > node.totalDemerit) {
      optimalNode = node;
    }
  }
  if (!optimalNode) {
    throw new Error("Could not find optimal path.");
  }

  // If looseness is non-zero, we may want to choose a different node.
  if (looseness !== 0) {
    for (
      let node = firstActiveNode, bestDelta = 0, bestDemerit = optimalNode.totalDemerit;
      node;
      node = node.link
    ) {
      const delta = node.lineIndex - optimalNode.lineIndex;
      if ((looseness <= delta && delta < bestDelta) || (bestDelta < delta && delta <= looseness)) {
        bestDelta = delta;
        bestDemerit = node.totalDemerit;
        optimalNode = node;
      } else if (bestDelta === delta && node.totalDemerit < bestDemerit) {
        bestDemerit = node.totalDemerit;
        optimalNode = node;
      }
    }
  }

  const lines: Array<Line> = [];
  let node: Node | undefined = optimalNode;
  while (node) {
    if (node.previous) {
      lines.push({
        startIndex: node.previous.breakPoint ? node.previous.breakPoint.itemIndex + 1 : 0,
        endIndex: node.breakPoint ? node.breakPoint.itemIndex + 1 : 0,
        adjustmentRatio: node.adjustmentRatio,
        naturalWidth: node.naturalWidth,
        isOverfull: node.isOverfull,
        isUnderfull: node.isUnderfull,
      });
    }
    node = node.previous;
  }

  for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx--) {
    yield lines[lineIdx];
  }
}

export const optimalBreaksWithFallback = (
  paraItems: ParagraphItem[],
  paraWidth: number,
): Line[] => {
  const params: OptimiserParameters = { upperAdjustmentRatio: 4.0 };
  try {
    // optimistic: no overfull boxes
    return Array.from(optimalBreaks(paraItems, paraWidth, params));
  } catch {
    // Oh, dear. There was no solution, allow overfull boxes.
  }
  params.allowOverfull = true;
  params.looseness = -2;
  params.upperAdjustmentRatio = 10.0;
  const lines = Array.from(optimalBreaks(paraItems, paraWidth, params));

  // Did we end up with some overfull boxes despite our best effort?
  const hasOverfull = lines.some((l) => l.isOverfull);
  if (hasOverfull) {
    params.emergencyStretch = 0.05 * paraWidth;
    return Array.from(optimalBreaks(paraItems, paraWidth, params));
  }

  return lines;
};

// Use polyfilled segmenter if necessary.
const getSegmenterClass = async () =>
  Intl.Segmenter ?? ((await createIntlSegmenterPolyfill()) as any as typeof Intl.Segmenter);
export const wordSegmenterPromise = (async () =>
  new (await getSegmenterClass())("en", { granularity: "word" }))();
export const sentenceSegmenterPromise = (async () =>
  new (await getSegmenterClass())("en", { granularity: "sentence" }))();
