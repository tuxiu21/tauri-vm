import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [dirOutput, setDirOutput] = useState("");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runDir() {
    setIsRunning(true);
    setDirOutput("");
    setError("");
    try {
      const output = await invoke<string>("ssh_dir");
      setDirOutput(output);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="container">
      <h1>SSH dir</h1>
      <p>Connects to 192.168.5.100 as rin and runs dir.</p>
      <button type="button" onClick={runDir} disabled={isRunning}>
        {isRunning ? "Running..." : "Run dir"}
      </button>
      {error ? <p className="error">{error}</p> : null}
      <pre className="output">{dirOutput || "Waiting for output..."}</pre>
    </main>
  );
}

export default App;
