import { useEffect, useState, useId } from "react";
import "./App.css";

import { render } from "./canvasRendering";
import { Page } from "./svgRendering";

function App() {
  const optimalId = useId(),
    widthId = useId(),
    canvasId = useId();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [paraWidth, setParaWidth] = useState<number>(700);
  const [useOptimal, setUseOptimal] = useState<boolean>(true);
  const [useCanvas, setUseCanvas] = useState<boolean>(true);

  useEffect(() => {
    if (!canvasEl) {
      return;
    }
    render(canvasEl, useOptimal, paraWidth);
  }, [canvasEl, useOptimal, paraWidth]);

  return (
    <div className="App">
      <div>
        <input
          id={optimalId}
          type="checkbox"
          checked={useOptimal}
          onChange={({ target: { checked } }) => {
            setUseOptimal(checked);
          }}
        />
        <label htmlFor={optimalId}>Use optimal algorithm</label>
      </div>
      <div>
        <input
          id={canvasId}
          type="checkbox"
          checked={useCanvas}
          onChange={({ target: { checked } }) => {
            setUseCanvas(checked);
          }}
        />
        <label htmlFor={canvasId}>Use canvas</label>
      </div>
      <div>
        <input
          type="range"
          id={widthId}
          min="10"
          max="700"
          value={paraWidth}
          onChange={({ target: { value } }) => {
            setParaWidth(parseFloat(value));
          }}
        />
        <label htmlFor={widthId}>Paragraph width</label>
      </div>
      <div>
        {useCanvas ? (
          <canvas style={{ width: 800, height: 800 }} width="800" height="800" ref={setCanvasEl} />
        ) : (
          <svg width="800" height="800" viewBox="0 0 800 800">
            <Page width={800} height={800} paraWidth={paraWidth} />
          </svg>
        )}
      </div>
    </div>
  );
}

export default App;
