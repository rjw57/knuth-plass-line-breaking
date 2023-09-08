import { hyphenateSync } from "hyphen/en";
import { createIntlSegmenterPolyfill } from "intl-segmenter-polyfill/dist/bundled";

const unwrap = (text: string) => text.replaceAll("\n", " ");
const paragraphs = [
  `I call our world Flatland, not because we call it so, but to make its nature clearer to you, my
happy readers, who are privileged to live in Space.`,
  `Imagine a vast sheet of paper on which straight Lines, Triangles, Squares, Pentagons, Hexagons,
and other figures, instead of remaining fixed in their places, move freely about, on or in the
surface, but without the power of rising above or sinking below it, very much like
shadows\u00A0—\u00A0only hard with luminous edges\u00A0—\u00A0and you will then have a pretty
correct notion of my country and countrymen. Alas, a few years ago, I should have said “my
universe”:\u00A0but now my mind has been opened to higher views of things.`,
  `In such a country, you will perceive at once that it is impossible that there should be anything
of what you call a “solid” kind; but I dare say you will suppose that we could at least distinguish
by sight the Triangles, Squares, and other figures, moving about as I have described them. On the
contrary, we could see nothing of the kind, not at least so as to distinguish one figure from
another. Nothing was visible, nor could be visible, to us, except Straight Lines; and the necessity
of this I will speedily demonstrate.`,
  `Place a penny on the middle of one of your tables in Space; and leaning over it, look down upon
it. It will appear a circle.`,
  `But now, drawing back to the edge of the table, gradually lower your eye (thus bringing yourself
more and more into the condition of the inhabitants of Flatland), and you will find the penny
becoming more and more oval to your view, and at last when you have placed your eye exactly on the
edge of the table (so that you are, as it were, actually a Flatlander) the penny will then have
ceased to appear oval at all, and will have become, so far as you can see, a straight line.`,
  `The same thing would happen if you were to treat in the same way a Triangle, or a Square, or any
other figure cut out from pasteboard. As soon as you look at it with your eye on the edge of the
table, you will find that it ceases to appear to you as a figure, and that it becomes in appearance
a straight line. Take for example an equilateral Triangle\u00A0—\u00A0who represents with us a
Tradesman of the respectable class. Figure\u00A01 represents the Flatland Tradesman as you would
see him while you were bending over him from above; figures\u00A02 and 3 represent the Tradesman,
as you would see him if your eye were close to the level, or all but on the level of the table; and
if your eye were quite on the level of the table (and that is how we see him in Flatland) you would
see nothing but a straight line.`,
].map((s) => hyphenateSync(unwrap(s)));

const MAX_STRETCH = 100000;

const MAX_PENALTY = Infinity;
const HYPHEN_PENALTY = 10.0;
const LINE_PENALTY = 10.0;

interface Box {
  type: "box";
  width: number;
  font: string;
  text: string;
}

interface Glue {
  type: "glue";
  width: number;
  penalty: number;
  stretchability: number;
  shrinkability: number;
}

interface Penalty {
  type: "penalty";
  width: number;
  penalty: number;
  flagged: boolean;
  font?: string;
  text?: string;
}

export type ParagraphItem = Box | Glue | Penalty;

function* textToParagraphItems(
  text: string,
  ctx: CanvasRenderingContext2D,
  font: string,
  sentenceSegmenter: Intl.Segmenter,
  wordSegmenter: Intl.Segmenter,
): Generator<ParagraphItem> {
  ctx.save();
  try {
    ctx.font = font;

    const spaceWidth = ctx.measureText(" ").width;
    const overhangingPunctuationWidth = 0.5 * spaceWidth;
    const hyphenWidth = ctx.measureText("-").width - overhangingPunctuationWidth;
    const indentWidth = 8 * spaceWidth;

    // Starting glue
    yield {
      type: "glue",
      width: indentWidth,
      penalty: MAX_PENALTY,
      stretchability: 0.0,
      shrinkability: 0.0,
    };

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
            let width = ctx.measureText(syllable).width;
            if (syllableIdx === 0) {
              width += extraWidth;
            }
            if (syllableIdx === syllables.length - 1 && isPunctuation) {
              width -= overhangingPunctuationWidth;
            }
            yield {
              type: "box",
              width,
              font,
              text: syllable,
            };
            if (syllableIdx !== syllables.length - 1) {
              yield {
                type: "penalty",
                penalty: HYPHEN_PENALTY,
                width: hyphenWidth,
                flagged: true,
                font,
                text: "-",
              };
            }
          }
        }
        prevWasPunctuation = isPunctuation;
      }
    }

    // Finishing glue and forced line break.
    yield {
      type: "glue",
      width: 0.0,
      penalty: MAX_PENALTY,
      stretchability: MAX_STRETCH,
      shrinkability: 0.0,
    };
    yield { type: "penalty", width: 0.0, penalty: -MAX_PENALTY, flagged: true };
  } finally {
    ctx.restore();
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

// Use polyfilled segmenter if necessary.
const getSegmenterClass = async () =>
  Intl.Segmenter ?? ((await createIntlSegmenterPolyfill()) as any as typeof Intl.Segmenter);
const wordSegmenterPromise = (async () =>
  new (await getSegmenterClass())("en", { granularity: "word" }))();
const sentenceSegmenterPromise = (async () =>
  new (await getSegmenterClass())("en", { granularity: "sentence" }))();

export const render = async (
  canvasEl: HTMLCanvasElement,
  useOptimal: boolean,
  paraWidth: number,
) => {
  // Use polyfilled segmenter if necessary.
  const wordSegmenter = await wordSegmenterPromise;
  const sentenceSegmenter = await sentenceSegmenterPromise;

  await Promise.all(Array.from(document.fonts).map((f) => f.status === "loaded" || f.load()));

  const { width, height } = canvasEl;

  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    console.error("Could not create 2d context.");
    return;
  }

  const fontSize = 20;
  const lineHeight = 1.2 * fontSize;
  const font = `${fontSize}px Roman`;

  ctx.fillStyle = "#eee";
  ctx.strokeStyle = "rgba(255, 0, 0, 0.25)";
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.moveTo(fontSize, 0);
  ctx.lineTo(fontSize, height);
  ctx.moveTo(fontSize + paraWidth, 0);
  ctx.lineTo(fontSize + paraWidth, height);
  ctx.stroke();

  let y = lineHeight;
  for (const text of paragraphs) {
    const paraItems = Array.from(
      textToParagraphItems(text, ctx, font, sentenceSegmenter, wordSegmenter),
    );

    let lines: Line[];
    if (useOptimal) {
      const params: OptimiserParameters = { upperAdjustmentRatio: 4.0 };
      try {
        // optimistic: no overfull boxes
        lines = Array.from(optimalBreaks(paraItems, paraWidth, params));
      } catch {
        // Oh, dear. There was no solution, allow overfull boxes.
        params.allowOverfull = true;
        params.looseness = -2;
        params.upperAdjustmentRatio = 10.0;
        lines = Array.from(optimalBreaks(paraItems, paraWidth, params));
      }

      // Did we end up with some overfull boxes despite our best effort?
      const hasOverfull = lines.some((l) => l.isOverfull);
      if (hasOverfull) {
        params.emergencyStretch = 0.05 * paraWidth;
        lines = Array.from(optimalBreaks(paraItems, paraWidth, params));
      }
    } else {
      lines = Array.from(greedyBreaks(paraItems, paraWidth));
    }

    for (const line of lines) {
      ctx.fillStyle = line.isOverfull ? "#800" : (line.isUnderfull ? "#008" : "#000");
      let x = fontSize;
      for (let itemIndex = line.startIndex; itemIndex < line.endIndex; itemIndex++) {
        const item = paraItems[itemIndex];
        if (item.type === "box" || (itemIndex === line.endIndex - 1 && item.type === "penalty")) {
          if (item.font && item.text && item.text !== "") {
            ctx.font = item.font;
            ctx.fillText(item.text, x, y);
          }
          x += item.width;
        } else if (item.type === "glue" && itemIndex !== line.endIndex - 1) {
          x += item.width;
          if (line.adjustmentRatio < 0) {
            x += line.adjustmentRatio * item.shrinkability;
          } else if (line.adjustmentRatio > 0) {
            x += line.adjustmentRatio * item.stretchability;
          }
        }
      }

      ctx.font = `${fontSize * 0.8}px sans-serif`;
      ctx.fillStyle = "#888";
      ctx.fillText(`${line.adjustmentRatio.toFixed(2)}`, 2 * fontSize + paraWidth, y);

      y += lineHeight;
    }
  }
};
