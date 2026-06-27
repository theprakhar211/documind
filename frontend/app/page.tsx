'use client'

import { useState, useRef, useEffect } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL

// ── Types ──────────────────────────────────────────────
interface Chunk {
  text: string
  chunk_index: number
  filename: string
  score: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Chunk[]
  streaming?: boolean
}

interface EvalScore {
  context_recall: number
  answer_faithfulness: number
  answer_relevance: number
  aggregate?: number
  overall?: number
}

interface EvalQuestion {
  question: string
  ground_truth: string
  answer: string
  chunks_retrieved: number
  scores: EvalScore
}

interface EvalResult {
  total_questions: number
  aggregate_scores: EvalScore
  per_question: EvalQuestion[]
}

const DEFAULT_TEST_CASES = `[
  {
    "question": "What is this document about?",
    "ground_truth": "Your expected answer here"
  },
  {
    "question": "What are the main topics covered?",
    "ground_truth": "Your expected answer here"
  }
]`

// ── Score Badge ────────────────────────────────────────
function ScoreBadge({ label, score }: { label: string; score: number }) {
  const color = score >= 0.7 ? '#4ade80' : score >= 0.4 ? '#facc15' : '#f87171'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '0.25rem', padding: '0.75rem 1rem',
      background: 'var(--bg)', borderRadius: '10px',
      border: '1px solid var(--border)', minWidth: '100px',
    }}>
      <span style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{(score * 100).toFixed(0)}%</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{label}</span>
    </div>
  )
}

// ── Eval Question Row ──────────────────────────────────
function EvalQuestionRow({ item, index }: { item: EvalQuestion; index: number }) {
  const [open, setOpen] = useState(false)
  const agg = item.scores.aggregate ?? 0
  const color = agg >= 0.7 ? '#4ade80' : agg >= 0.4 ? '#facc15' : '#f87171'

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '10px',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.75rem 1rem', cursor: 'pointer',
          background: 'var(--surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, color,
            background: `${color}20`, padding: '0.2rem 0.5rem',
            borderRadius: '999px',
          }}>
            {(agg * 100).toFixed(0)}%
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
            Q{index + 1}: {item.question}
          </span>
        </div>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {open && (
        <div style={{ padding: '1rem', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <ScoreBadge label="Context Recall" score={item.scores.context_recall} />
            <ScoreBadge label="Faithfulness" score={item.scores.answer_faithfulness} />
            <ScoreBadge label="Relevance" score={item.scores.answer_relevance} />
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>ANSWER</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{item.answer}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>GROUND TRUTH</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.ground_truth}</div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {item.chunks_retrieved} chunks retrieved
          </div>
        </div>
      )}
    </div>
  )
}

// ── Upload Zone ────────────────────────────────────────
function UploadZone({ onUpload }: { onUpload: (docId: string, name: string) => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setError('Only PDF files are supported.')
      return
    }
    setUploading(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`${API}/documents/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      onUpload(data.doc_id, file.name)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', padding: '2rem', gap: '1rem',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          Docu<span style={{ color: 'var(--accent)' }}>Mind</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Upload a PDF. Ask anything. Get cited answers.
        </div>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        style={{
          width: '100%', maxWidth: '480px',
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '16px', padding: '3rem 2rem', textAlign: 'center',
          cursor: 'pointer', background: dragging ? 'var(--accent-dim)' : 'var(--surface)',
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{uploading ? '⏳' : '📄'}</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: '0.5rem' }}>
          {uploading ? 'Processing your document...' : 'Drop a PDF here'}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {uploading ? 'Chunking and embedding' : 'or click to browse — max 10MB'}
        </div>
        <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </div>

      {error && <div style={{ color: 'var(--error)', fontSize: '0.875rem' }}>{error}</div>}
    </div>
  )
}

// ── Source Card ────────────────────────────────────────
function SourceCard({ chunk, index }: { chunk: Chunk; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '0.75rem 1rem', cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>Chunk {index + 1}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>score {chunk.score} {open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)',
          lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: '0.75rem',
          whiteSpace: 'pre-wrap',
        }}>
          {chunk.text}
        </div>
      )}
    </div>
  )
}

// ── Chat Message ───────────────────────────────────────
function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      gap: '0.75rem', maxWidth: '100%',
    }}>
      <div style={{
        maxWidth: '80%',
        background: isUser ? 'var(--accent)' : 'var(--surface)',
        color: isUser ? '#fff' : 'var(--text-primary)',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '0.875rem 1.25rem', fontSize: '0.9375rem', lineHeight: 1.65,
        border: isUser ? 'none' : '1px solid var(--border)', whiteSpace: 'pre-wrap',
      }}>
        {message.content}
        {message.streaming && (
          <span style={{
            display: 'inline-block', width: '2px', height: '1em',
            background: 'var(--accent)', marginLeft: '2px',
            verticalAlign: 'text-bottom', animation: 'blink 0.8s step-end infinite',
          }} />
        )}
      </div>
      {message.sources && message.sources.length > 0 && (
        <div style={{ width: '80%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingLeft: '0.25rem' }}>
            {message.sources.length} source{message.sources.length > 1 ? 's' : ''} retrieved
          </div>
          {message.sources.map((chunk, i) => <SourceCard key={i} chunk={chunk} index={i} />)}
        </div>
      )}
    </div>
  )
}

// ── Chat View ──────────────────────────────────────────
function ChatView({ docId, filename, onReset }: { docId: string; filename: string; onReset: () => void }) {
  const [tab, setTab] = useState<'chat' | 'eval'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [testCases, setTestCases] = useState(DEFAULT_TEST_CASES)
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null)
  const [evalError, setEvalError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleDelete = async () => {
    try {
      await fetch(`${API}/documents/document/${docId}`, { method: 'DELETE' })
    } catch (e) {
      console.error('Delete failed', e)
    } finally {
      onReset()
    }
  }

  const send = async () => {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    try {
      const res = await fetch(`${API}/qa/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, question }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let sources: Chunk[] = []
      let content = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = JSON.parse(line.slice(6))
          if (json.type === 'sources') {
            sources = json.chunks
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, sources } : m))
          } else if (json.type === 'token') {
            content += json.content
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content } : m))
          } else if (json.type === 'done') {
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, streaming: false } : m))
          }
        }
      }
    } catch (e) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: 'Something went wrong. Try again.', streaming: false } : m
      ))
    } finally {
      setLoading(false)
    }
  }

  const runEval = async () => {
    setEvalError('')
    setEvalResult(null)
    let parsed
    try {
      parsed = JSON.parse(testCases)
    } catch {
      setEvalError('Invalid JSON. Check your test cases format.')
      return
    }
    setEvalRunning(true)
    try {
      const res = await fetch(`${API}/qa/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, test_cases: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Eval failed')
      setEvalResult(data)
    } catch (e: any) {
      setEvalError(e.message)
    } finally {
      setEvalRunning(false)
    }
  }

  const tabStyle = (active: boolean) => ({
    padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500,
    cursor: 'pointer', border: 'none', borderRadius: '8px',
    background: active ? 'var(--accent)' : 'none',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
            Docu<span style={{ color: 'var(--accent)' }}>Mind</span>
          </span>
          <span style={{
            fontSize: '0.75rem', padding: '0.2rem 0.6rem',
            background: 'var(--accent-dim)', color: 'var(--accent)',
            borderRadius: '999px', fontWeight: 500,
          }}>
            📄 {filename}
          </span>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginLeft: '0.5rem' }}>
            <button style={tabStyle(tab === 'chat')} onClick={() => setTab('chat')}>Chat</button>
            <button style={tabStyle(tab === 'eval')} onClick={() => setTab('eval')}>Eval</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleDelete}
            style={{
              fontSize: '0.8rem', color: 'var(--error)', background: 'none',
              border: '1px solid var(--error)', borderRadius: '8px',
              padding: '0.4rem 0.75rem', cursor: 'pointer',
            }}
          >
            Delete document
          </button>
          <button
            onClick={onReset}
            style={{
              fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'none',
              border: '1px solid var(--border)', borderRadius: '8px',
              padding: '0.4rem 0.75rem', cursor: 'pointer',
            }}
          >
            New document
          </button>
        </div>
      </div>

      {/* Chat Tab */}
      {tab === 'chat' && (
        <>
          <div style={{
            flex: 1, overflowY: 'auto', padding: '1.5rem',
            display: 'flex', flexDirection: 'column', gap: '1.5rem',
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '4rem', fontSize: '0.9rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>💬</div>
                Ask anything about <strong style={{ color: 'var(--text-primary)' }}>{filename}</strong>
              </div>
            )}
            {messages.map((m, i) => <ChatMessage key={i} message={m} />)}
            <div ref={bottomRef} />
          </div>
          <div style={{
            padding: '1rem 1.5rem', borderTop: '1px solid var(--border)',
            background: 'var(--surface)', display: 'flex', gap: '0.75rem',
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ask a question about your document..."
              disabled={loading}
              style={{
                flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '0.75rem 1rem', color: 'var(--text-primary)',
                fontSize: '0.9375rem', outline: 'none',
              }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              style={{
                background: loading || !input.trim() ? 'var(--border)' : 'var(--accent)',
                color: '#fff', border: 'none', borderRadius: '12px',
                padding: '0.75rem 1.25rem', cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: '0.875rem', transition: 'background 0.15s',
              }}
            >
              {loading ? '...' : 'Ask'}
            </button>
          </div>
        </>
      )}

      {/* Eval Tab */}
      {tab === 'eval' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.5rem' }}>
              Test Cases
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Provide questions with known correct answers. The eval pipeline scores context recall, answer faithfulness, and answer relevance.
            </div>
            <textarea
              value={testCases}
              onChange={e => setTestCases(e.target.value)}
              rows={10}
              style={{
                width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '0.875rem', color: 'var(--text-primary)',
                fontSize: '0.8rem', fontFamily: 'monospace', outline: 'none',
                resize: 'vertical', lineHeight: 1.6,
              }}
            />
          </div>

          <button
            onClick={runEval}
            disabled={evalRunning}
            style={{
              background: evalRunning ? 'var(--border)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: '10px',
              padding: '0.75rem 1.5rem', cursor: evalRunning ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: '0.875rem', alignSelf: 'flex-start',
            }}
          >
            {evalRunning ? 'Running eval...' : 'Run Eval'}
          </button>

          {evalError && (
            <div style={{ color: 'var(--error)', fontSize: '0.875rem' }}>{evalError}</div>
          )}

          {evalResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Aggregate scores */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '1.25rem',
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem', fontWeight: 600 }}>
                  AGGREGATE — {evalResult.total_questions} questions
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ textAlign: 'center', marginRight: '0.5rem' }}>
                    <div style={{
                      fontSize: '2.5rem', fontWeight: 800,
                      color: evalResult.aggregate_scores.overall! >= 0.7 ? '#4ade80'
                        : evalResult.aggregate_scores.overall! >= 0.4 ? '#facc15' : '#f87171',
                    }}>
                      {(evalResult.aggregate_scores.overall! * 100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Overall</div>
                  </div>
                  <ScoreBadge label="Context Recall" score={evalResult.aggregate_scores.context_recall} />
                  <ScoreBadge label="Faithfulness" score={evalResult.aggregate_scores.answer_faithfulness} />
                  <ScoreBadge label="Relevance" score={evalResult.aggregate_scores.answer_relevance} />
                </div>
              </div>

              {/* Per question */}
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', fontWeight: 600 }}>
                  PER QUESTION
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {evalResult.per_question.map((item, i) => (
                    <EvalQuestionRow key={i} item={item} index={i} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
      `}</style>
    </div>
  )
}

// ── Root ───────────────────────────────────────────────
export default function Home() {
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null)

  return doc
    ? <ChatView docId={doc.id} filename={doc.name} onReset={() => setDoc(null)} />
    : <UploadZone onUpload={(id, name) => setDoc({ id, name })} />
}