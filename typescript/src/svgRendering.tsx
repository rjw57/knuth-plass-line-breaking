import React, { useEffect, useState } from "react";
import * as LineBreaking from "./linebreaking";
import * as Text from "./text";

interface PageProps {
  width: number;
  height: number;
  paraWidth: number;
  useOptimal?: boolean;
}

const useWordSegmenter = () => {
  const [segmenter, setSegmenter] = useState<Intl.Segmenter>();
  useEffect(() => {
    LineBreaking.wordSegmenterPromise.then(setSegmenter);
  }, [setSegmenter]);
  return segmenter;
};

const useSentenceSegmenter = () => {
  const [segmenter, setSegmenter] = useState<Intl.Segmenter>();
  useEffect(() => {
    LineBreaking.sentenceSegmenterPromise.then(setSegmenter);
  }, [setSegmenter]);
  return segmenter;
};

class SvgFont implements LineBreaking.Font {
  private textEl: SVGTextElement;

  constructor(textEl: SVGTextElement) {
    this.textEl = textEl;
  }

  measureText(text: string) {
    this.textEl.textContent = text.replaceAll(" ", "\u00a0");
    return this.textEl.getComputedTextLength();
  }
}

export const Page = (props: PageProps) => {
  const { width, height, paraWidth, useOptimal } = { ...props };
  const wordSegmenter = useWordSegmenter(),
    sentenceSegmenter = useSentenceSegmenter();
  const [textEl, setTextEl] = useState<SVGTextElement | null>(null);

  interface Box {
    x: number;
    y: number;
    text: string;
  }
  const [boxes, setBoxes] = useState<Box[]>([]);

  const fontSize = 20;
  const lineHeight = 1.2 * fontSize;
  useEffect(() => {
    //const fontName = `${fontSize}px Roman`;
    if (!textEl || !wordSegmenter || !sentenceSegmenter) {
      setBoxes([]);
      return;
    }

    const font = new SvgFont(textEl);
    const newBoxes: Box[] = [];
    let y = lineHeight;
    for (const text of Text.paragraphs) {
      const paraItems = [
        ...LineBreaking.paragraphInitialItems({ indentWidth: font.measureText("        ") }),
        ...LineBreaking.paragraphItemsForText(text, font, sentenceSegmenter, wordSegmenter),
        ...LineBreaking.paragraphFinalItems(),
      ];

      const lines = useOptimal
        ? LineBreaking.optimalBreaksWithFallback(paraItems, paraWidth)
        : Array.from(LineBreaking.greedyBreaks(paraItems, paraWidth));

      for (const line of lines) {
        let x = fontSize;
        for (let itemIndex = line.startIndex; itemIndex < line.endIndex; itemIndex++) {
          const item = paraItems[itemIndex];
          if (
            item.type === "box" ||
            (itemIndex === line.endIndex - 1 && item.type === "penalty")
          ) {
            if (item.text && item.text !== "") {
              newBoxes.push({ x, y, text: item.text });
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

        y += lineHeight;
      }
    }

    setBoxes(newBoxes);
  }, [
    textEl,
    wordSegmenter,
    sentenceSegmenter,
    setBoxes,
    paraWidth,
    useOptimal,
    lineHeight,
    fontSize,
  ]);

  return (
    <>
      <rect x={0} y={0} width={width} height={height} style={{ fill: "#eee" }} />
      <line
        x1={fontSize}
        y1={0}
        x2={fontSize}
        y2={height}
        style={{ stroke: "rgba(255, 0, 0, 0.25)" }}
      />
      <line
        x1={fontSize + paraWidth}
        y1={0}
        x2={fontSize + paraWidth}
        y2={height}
        style={{ stroke: "rgba(255, 0, 0, 0.25)" }}
      />
      <text ref={setTextEl} style={{ visibility: "hidden", fontFamily: "Roman", fontSize: fontSize }}>
        Hello
      </text>
      {boxes.map(({ x, y, text }, idx) => (
        <text x={x} y={y} key={idx} style={{ fontFamily: "Roman", fontSize: `${fontSize}px` }}>
          {text}
        </text>
      ))}
    </>
  );
};
