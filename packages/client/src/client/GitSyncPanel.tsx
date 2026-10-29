// Optional Git sync panel: status and buttons for a local mirror, backed by an
// installed layerfs-git-sync CLI (Host git-sync.js). The panel is a thin shell:
// the CLI owns git, the manifest and conflict worktrees. A conflict leaves a
// worktree path; the user resolves it with their normal git tools and returns
// here to continue.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type GitSyncStatus } from './api.ts'

const line = 'var(--dsh-color-border, #8884)'
const muted = 'var(--dsh-color-fg-muted, #8a8a8a)'
const danger = 'var(--dsh-color-fg-danger, #d33)'
const button = { font: 'inherit', fontSize: 12, padding: '4px 12px', borderRadius: 6, border: `1px solid ${line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' } as const
const off = { opacity: 0.45, cursor: 'not-allowed' } as const
const mono = { fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: 11 } as const
const short = (value?: string | null) => value ? value.slice(0, 12) : '—'

export function GitSyncPanel({ name, onClose, onChanged }: { name: string, onClose: () => void, onChanged?: () => void }) {
  const [state, setState] = useState<GitSyncStatus | null>(null)
  const [mirror, setMirror] = useState('')
  const [ref, setRef] = useState('main')
  const [mergeInto, setMergeInto] = useState('')
  const [publish, setPublish] = useState(true)
  const [resolved, setResolved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const read = async () => {
    try {
      const next = await api.projectGit(name)
      setState(next)
      if (next.mirror) setMirror((current) => current || next.mirror!)
      if (next.status?.lastExportRef) setRef(next.status.lastExportRef)
      setError(null)
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void read() }, [name])
  useEffect(() => {
    const found = error?.match(/(?:worktree|工作区)[：:]\s*([^\n。]+)/i)
    if (found?.[1]) setResolved(found[1].trim())
  }, [error])

  const run = async (label: string, body: Parameters<typeof api.projectGitAction>[1]) => {
    setBusy(label); setError(null); setWarning(null)
    try {
      const answer = await api.projectGitAction(name, body)
      const result = answer.result as any
      const skipped = result?.skipped
      if (result?.binaryError) setWarning(`Binary export failed; the branch is text-only: ${result.binaryError}`)
      else if (Array.isArray(skipped) && skipped.length) setWarning(`Exported without ${skipped.length} binary file(s): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`)
      if (answer.status) setState(answer.status)
      else await read()
    } catch (e) {
      setError((e as Error).message)
      await read().catch(() => {})
    } finally { setBusy(null) }
  }

  const status = state?.status
  const conflict = !!error && /worktree|冲突/i.test(error)
  return createPortal(
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div role="dialog" aria-label={`Git sync for ${name}`}
        style={{ width: 640, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', display: 'grid', gap: 12, padding: 20, borderRadius: 14, background: 'var(--dsh-color-bg, #fff)', color: 'var(--dsh-color-fg, #111)', border: `1px solid ${line}`, fontSize: 13, lineHeight: 1.5, boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Git sync</div>
          <div style={{ color: muted }}>{name}</div>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy} onClick={onClose}>Close</button>
        </div>

        {!state && <div style={{ color: muted }}>Reading Git sync state…</div>}
        {state && !state.configured && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: muted }}>Choose a local git mirror (a clone of the team repository). The panel initializes the sync manifest if it is missing; it does not push.</div>
            <input value={mirror} onChange={(e) => setMirror(e.target.value)} spellCheck={false} autoComplete="off"
              placeholder="D:\\work\\my-repo" style={{ ...button, cursor: 'text', padding: '6px 8px', ...mono }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...button, ...(busy || !mirror.trim() ? off : {}) }} disabled={!!busy || !mirror.trim()}
                onClick={() => void run('Configure', { action: 'configure', mirror: mirror.trim() })}>{busy ?? 'Use this mirror'}</button>
              <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy} onClick={() => void read()}>Refresh</button>
            </div>
          </div>
        )}

        {state?.configured && (
          <>
            <div style={{ display: 'grid', gap: 4, padding: 10, borderRadius: 8, background: 'var(--dsh-color-bg-layer-1, #f6f6f6)' }}>
              <div><span style={{ color: muted }}>mirror </span><span style={mono}>{state.mirror}</span></div>
              <div><span style={{ color: muted }}>command </span><span style={mono}>{state.command}</span></div>
              {status && <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
                  <span><span style={{ color: muted }}>git HEAD </span><span style={mono}>{short(status.gitHead)}</span></span>
                  <span><span style={{ color: muted }}>LayerFS main </span><span style={mono}>{short(status.layerfsMain)}</span></span>
                  <span><span style={{ color: muted }}>LayerFS </span><b>{status.layerfsChanged ? 'ahead' : 'clean'}</b></span>
                  <span><span style={{ color: muted }}>git </span><b>{status.gitChanged ? 'new commits' : 'clean'}</b></span>
                </div>
                <div><span style={{ color: status.layerfsChanged || status.gitChanged ? danger : muted }}>{status.advice}</span></div>
                {status.pendingPublish && <div><span style={{ color: muted }}>pending LayerFS Branch </span><span style={mono}>{status.pendingPublish}</span></div>}
                {status.gitDiverged && <div style={{ color: danger }}>git history diverged; merge/rebase first.</div>}
              </>}
              {state.error && <div style={{ color: danger }}>{state.error}</div>}
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 500 }}>Export LayerFS to git</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'grid', gap: 2 }}><span style={{ color: muted, fontSize: 12 }}>ref</span>
                  <input value={ref} onChange={(e) => setRef(e.target.value)} style={{ ...button, cursor: 'text', padding: '4px 6px', width: 150, ...mono }} /></label>
                <label style={{ display: 'grid', gap: 2 }}><span style={{ color: muted, fontSize: 12 }}>merge into (optional)</span>
                  <input value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} placeholder="main" style={{ ...button, cursor: 'text', padding: '4px 6px', width: 150, ...mono }} /></label>
                <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy}
                  onClick={() => void run('Exporting…', { action: 'export', ref: ref.trim() || 'main', ...(mergeInto.trim() ? { mergeInto: mergeInto.trim() } : {}) })}>{busy === 'Exporting…' ? busy : 'Export'}</button>
              </div>
              <div style={{ color: muted, fontSize: 12 }}>Export writes a local branch; with a merge target it also merges that branch (a conflict is left as normal git conflict). It never pushes.</div>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 500 }}>Import git into LayerFS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> publish main</label>
                <button type="button" style={{ ...button, ...(busy || !status?.lastExportLayerfsCommit ? off : {}) }} disabled={!!busy || !status?.lastExportLayerfsCommit}
                  title={status?.lastExportLayerfsCommit ? undefined : 'Export a baseline first; importing into an unsynced mirror can replace LayerFS content.'}
                  onClick={() => void run('Importing…', { action: 'import', publish })}>{busy === 'Importing…' ? busy : 'Import'}</button>
                <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy}
                  onClick={() => void run('Publishing…', { action: 'publish' })}>Publish pending</button>
              </div>
              <div style={{ color: muted, fontSize: 12 }}>Import writes a LayerFS sync Branch; publish is separate unless checked. Non-overlapping changes merge automatically; a conflict opens a worktree.</div>
            </div>

            {(conflict || resolved) && (
              <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 8, border: `1px solid ${line}` }}>
                <div style={{ fontWeight: 500 }}>Resolve a conflict</div>
                <div style={{ color: muted }}>Resolve the files in the worktree, run <span style={mono}>git add</span>/<span style={mono}>git commit</span>, then continue here.</div>
                <input value={resolved} onChange={(e) => setResolved(e.target.value)} placeholder="C:\\...\\layerfs-git-sync-merge-..." style={{ ...button, cursor: 'text', padding: '6px 8px', ...mono }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={{ ...button, ...(busy || !resolved.trim() ? off : {}) }} disabled={!!busy || !resolved.trim()}
                    onClick={() => void run('Resolving…', { action: 'import', resolved: resolved.trim(), publish })}>Continue after resolution</button>
                  <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy}
                    onClick={() => void run('Aborting…', { action: 'import', abort: true })}>Abort conflict</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={{ ...button, ...(busy ? off : {}) }} disabled={!!busy} onClick={() => void read()}>Refresh status</button>
            </div>
          </>
        )}

        {warning && <div role="status" style={{ color: 'var(--dsh-color-fg-warning, #a60)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{warning}</div>}
        {error && <div role="alert" style={{ color: danger, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</div>}
      </div>
    </div>, document.body)
}