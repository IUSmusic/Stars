export function installEvaluationPanel({ container, onRun, onExport }) {
      const card = document.createElement('div');
      card.id = 'evaluation-card';
      card.className = 'ui-corner';
      card.innerHTML = `
        <div class="corner-title">Evaluation</div>
        <div class="framing-note">Run the reproducibility benchmarks introduced for the research-grade package.</div>
        <div class="scenario-grid" style="margin-top:10px;">
          <button class="ctrl-btn scenario-btn" id="run-eval-btn">Run Benchmarks</button>
          <button class="ctrl-btn scenario-btn" id="export-eval-btn">Export Report</button>
        </div>
        <pre id="evaluation-output" style="margin-top:10px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.32rem;line-height:1.55;color:var(--text-soft);max-height:180px;overflow:auto;">Benchmarks not run yet.</pre>
      `;
      container.appendChild(card);
      const runBtn = card.querySelector('#run-eval-btn');
      const exportBtn = card.querySelector('#export-eval-btn');
      const output = card.querySelector('#evaluation-output');
      let lastReport = null;
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        output.textContent = 'Running evaluation suite...';
        try {
          lastReport = await onRun();
          output.textContent = lastReport.summary || 'Evaluation completed.';
        } catch (error) {
          console.error(error);
          output.textContent = `Evaluation failed: ${error.message}`;
        } finally {
          runBtn.disabled = false;
        }
      });
      exportBtn.addEventListener('click', async () => {
        try {
          if (!lastReport) lastReport = await onRun();
          await onExport(lastReport);
          output.textContent = `${lastReport.summary || 'Evaluation completed.'}

Exported results JSON.`;
        } catch (error) {
          console.error(error);
          output.textContent = `Export failed: ${error.message}`;
        }
      });
      return card;
    }
