import { useEffect, useReducer } from "react";
import { engine } from "../engine";

/** Re-render whenever the engine changes. */
export function useEngine() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => engine.subscribe(bump), []);
  return engine;
}
