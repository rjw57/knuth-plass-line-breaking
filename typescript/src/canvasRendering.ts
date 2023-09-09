import * as LineBreaking from "./linebreaking";
import { paragraphs } from "./text";

class CanvasFont implements LineBreaking.Font {
  private ctx: CanvasRenderingContext2D;
  private font: string;

  constructor(ctx: CanvasRenderingContext2D, font: string) {
    this.ctx = ctx;
    this.font = font;
  }

  measureText(text: string): number {
    this.ctx.save();
    try {
      this.makeCurrent();
      return this.ctx.measureText(text).width;
    } finally {
      this.ctx.restore();
    }
  }

  makeCurrent() {
    this.ctx.font = this.font;
  }
}

export const render = async (
  canvasEl: HTMLCanvasElement,
  useOptimal: boolean,
  paraWidth: number,
) => {
  // Get the device pixel ratio, falling back to 1.
  var dpr = window.devicePixelRatio || 1;
  // Get the size of the canvas in CSS pixels.
  var rect = canvasEl.getBoundingClientRect();

  // Give the canvas pixel dimensions of their CSS
  // size * the device pixel ratio.
  canvasEl.width = rect.width * dpr;
  canvasEl.height = rect.height * dpr;

  // Use polyfilled segmenter if necessary.
  const wordSegmenter = await LineBreaking.wordSegmenterPromise;
  const sentenceSegmenter = await LineBreaking.sentenceSegmenterPromise;

  await Promise.all(Array.from(document.fonts).map((f) => f.status === "loaded" || f.load()));

  const { width, height } = canvasEl;

  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    console.error("Could not create 2d context.");
    return;
  }
  // Scale all drawing operations by the dpr, so you
  // don't have to worry about the difference.
  ctx.scale(dpr, dpr);

  const fontSize = 20;
  const lineHeight = 1.2 * fontSize;
  const fontName = `${fontSize}px Roman`;
  const font = new CanvasFont(ctx, fontName);

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
    const paraItems = [
      ...LineBreaking.paragraphInitialItems({ indentWidth: font.measureText("        ") }),
      ...LineBreaking.paragraphItemsForText(text, font, sentenceSegmenter, wordSegmenter),
      ...LineBreaking.paragraphFinalItems(),
    ];

    const lines = useOptimal
      ? LineBreaking.optimalBreaksWithFallback(paraItems, paraWidth)
      : Array.from(LineBreaking.greedyBreaks(paraItems, paraWidth));

    for (const line of lines) {
      ctx.fillStyle = line.isOverfull ? "#800" : line.isUnderfull ? "#008" : "#000";
      let x = fontSize;
      for (let itemIndex = line.startIndex; itemIndex < line.endIndex; itemIndex++) {
        const item = paraItems[itemIndex];
        if (item.type === "box" || (itemIndex === line.endIndex - 1 && item.type === "penalty")) {
          if (item.text && item.text !== "") {
            (item.font as CanvasFont).makeCurrent();
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
