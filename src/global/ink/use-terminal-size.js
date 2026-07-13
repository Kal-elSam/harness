import { useEffect, useState } from "react";
import { useStdout } from "ink";
import { resolveLayoutMode } from "./layout.js";

/**
 * Live terminal size + layout mode. Updates on stdout resize.
 */
export function useTerminalSize({
  initialColumns = 80,
  initialRows = 24
} = {}) {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => ({
    columns: stdout?.columns ?? initialColumns,
    rows: stdout?.rows ?? initialRows
  }));

  useEffect(() => {
    if (!stdout || typeof stdout.on !== "function") return undefined;

    const sync = () => {
      setSize({
        columns: stdout.columns ?? initialColumns,
        rows: stdout.rows ?? initialRows
      });
    };

    sync();
    stdout.on("resize", sync);
    return () => {
      stdout.off("resize", sync);
    };
  }, [stdout, initialColumns, initialRows]);

  return {
    ...size,
    layoutMode: resolveLayoutMode(size)
  };
}
