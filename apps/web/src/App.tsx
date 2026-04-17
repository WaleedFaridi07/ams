import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type AgentOutputMode = 'text' | 'json'

type Agent = {
  id: string
  name: string
  description: string
  goal: string
  systemPrompt: string
  outputMode: AgentOutputMode
  hasKnowledge: boolean
  knowledgeOnly: boolean
  internetEnabled: boolean
  mcpEnabled: boolean
  mcpUrl: string | null
  childAgents: Array<{ id: string; name: string }>
  createdAt: string
}

type SkillResponse = {
  result: {
    systemPrompt: string
    constraints: string[]
    examplePrompts: string[]
    evaluationCases: string[]
  }
}

type ChatApiResponse = {
  provider: 'langchain' | 'mock'
  response: string | Record<string, string>
  retrievedChunkCount: number
  traceId?: string | null
  delegation?: {
    attempted: boolean
    selectedChildAgentId: string | null
    selectedChildAgentName: string | null
    success: boolean
    latencyMs: number
    reason: string
    error?: string
  }
  mcpInvocation?: {
    attempted: boolean
    success: boolean
    serverUrl?: string
    error?: string
  }
}

type McpTestResponse = {
  ok: boolean
  toolCount: number
  tools: string[]
}

type AgentFeedbackMetric = {
  agentId: string
  agentName: string
  votes: number
  positiveVotes: number
  negativeVotes: number
  positiveRate: number | null
  judgeCount: number
  judgeAvg: number | null
}

type KnowledgeFile = {
  fileName: string
  content: string
  contentEncoding?: 'utf8' | 'base64'
  mimeType?: string
}

type Toast = {
  id: string
  kind: 'success' | 'error'
  message: string
}

type ChatTurn = {
  id: string
  role: 'user' | 'assistant'
  text: string
  meta?: string
  traceId?: string
  feedbackSubmitted?: boolean
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

const initialCreateForm = {
  name: '',
  description: '',
  goal: '',
  outputMode: 'text' as AgentOutputMode,
  systemPrompt: '',
  hasKnowledge: false,
  knowledgeOnly: true,
  internetEnabled: true,
  mcpEnabled: false,
  mcpUrl: `${API_BASE_URL}/demo/mcp`,
  mcpSecret: '',
  childAgentIds: [] as string[],
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function chatText(response: string | Record<string, string>): string {
  return typeof response === 'string' ? response : JSON.stringify(response, null, 2)
}

function App() {
  const initialSearchTerm = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('q')?.trim() ?? ''
  }, [])

  const [agents, setAgents] = useState<Agent[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [feedbackMetrics, setFeedbackMetrics] = useState<AgentFeedbackMetric[]>([])

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const [createForm, setCreateForm] = useState(initialCreateForm)
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([])
  const [skillDraft, setSkillDraft] = useState<SkillResponse['result'] | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isTestingMcp, setIsTestingMcp] = useState(false)

  const [chatAgent, setChatAgent] = useState<Agent | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatUseKnowledge, setChatUseKnowledge] = useState(true)
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([])
  const [isChatting, setIsChatting] = useState(false)
  const [feedbackLoadingIds, setFeedbackLoadingIds] = useState<string[]>([])
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const hasAgents = agents.length > 0

  function addToast(kind: Toast['kind'], message: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 4000)
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }

  function resetCreateModal() {
    setCreateForm(initialCreateForm)
    setKnowledgeFiles([])
    setSkillDraft(null)
  }

  async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init)

    if (!response.ok) {
      let message = `Request failed: ${response.status}`
      const raw = await response.text()

      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; details?: unknown }
          message = parsed.error ?? raw
          if (parsed.details) {
            message = `${message}`
          }
        } catch {
          message = raw
        }
      }

      throw new Error(message)
    }

    return (await response.json()) as T
  }

  async function loadAgents() {
    const data = await requestJson<{ agents: Agent[] }>(`${API_BASE_URL}/agents`)
    setAgents(data.agents)
  }

  async function loadFeedbackMetrics() {
    const data = await requestJson<{ metrics: AgentFeedbackMetric[] }>(
      `${API_BASE_URL}/metrics/agents/feedback?days=30`
    )
    setFeedbackMetrics(data.metrics)
  }

  useEffect(() => {
    loadAgents().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to load agents'
      addToast('error', message)
    })

    loadFeedbackMetrics().catch(() => {
      setFeedbackMetrics([])
    })
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)

    if (searchTerm.trim()) {
      url.searchParams.set('q', searchTerm.trim())
    } else {
      url.searchParams.delete('q')
    }

    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next)
  }, [searchTerm])

  useEffect(() => {
    if (!chatAgent) {
      return
    }

    const node = chatLogRef.current
    if (!node) {
      return
    }

    const id = window.requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    })

    return () => window.cancelAnimationFrame(id)
  }, [chatAgent, chatHistory, isChatting])

  useEffect(() => {
    function isTypingElement(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false
      }

      const tagName = target.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return true
      }

      return target.isContentEditable
    }

    function onSlashFocus(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (isTypingElement(event.target)) {
        return
      }

      event.preventDefault()
      searchInputRef.current?.focus()
    }

    window.addEventListener('keydown', onSlashFocus)
    return () => window.removeEventListener('keydown', onSlashFocus)
  }, [])

  async function handleKnowledgeFileSelection(files: FileList | null) {
    if (!files || files.length === 0) {
      setKnowledgeFiles([])
      return
    }

    const loaded = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<KnowledgeFile>((resolve, reject) => {
            const reader = new FileReader()
            const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

            reader.onload = () => {
              if (isPdf) {
                resolve({
                  fileName: file.name,
                  content: arrayBufferToBase64(reader.result as ArrayBuffer),
                  contentEncoding: 'base64',
                  mimeType: file.type || 'application/pdf',
                })
                return
              }

              resolve({
                fileName: file.name,
                content: String(reader.result ?? ''),
                contentEncoding: 'utf8',
                mimeType: file.type || 'text/plain',
              })
            }

            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))

            if (isPdf) {
              reader.readAsArrayBuffer(file)
            } else {
              reader.readAsText(file)
            }
          })
      )
    )

    setKnowledgeFiles(loaded.filter((item) => item.content.length > 0))
  }

  async function handleGenerateSkillDraft(event: FormEvent) {
    event.preventDefault()
    setIsDrafting(true)

    try {
      const data = await requestJson<SkillResponse>(`${API_BASE_URL}/skills/agent-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description,
          goal: createForm.goal,
          outputMode: createForm.outputMode,
        }),
      })

      setSkillDraft(data.result)
      setCreateForm((prev) => ({ ...prev, systemPrompt: data.result.systemPrompt }))
      addToast('success', 'Draft prompt generated')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to generate draft prompt'
      addToast('error', message)
    } finally {
      setIsDrafting(false)
    }
  }

  async function handleCreateAgent(event: FormEvent) {
    event.preventDefault()
    setIsCreating(true)

    try {
      const mcpUrl = createForm.mcpUrl.trim()
      const mcpSecret = createForm.mcpSecret.trim()

      if (createForm.mcpEnabled && (!mcpUrl || !mcpSecret)) {
        addToast('error', 'MCP URL and MCP secret are required when MCP is enabled')
        setIsCreating(false)
        return
      }

      const data = await requestJson<{ agent: Agent }>(`${API_BASE_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          hasKnowledge: createForm.hasKnowledge || knowledgeFiles.length > 0,
          knowledgeFiles,
          mcpUrl: createForm.mcpEnabled ? mcpUrl : undefined,
          mcpSecret: createForm.mcpEnabled ? mcpSecret : undefined,
          childAgentIds: createForm.childAgentIds,
        }),
      })

      await loadAgents()
      setIsCreateOpen(false)
      resetCreateModal()
      addToast('success', `Agent '${data.agent.name}' created`) 
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create agent'
      addToast('error', message)
    } finally {
      setIsCreating(false)
    }
  }

  async function handleTestMcpConnection() {
    const mcpUrl = createForm.mcpUrl.trim()
    const mcpSecret = createForm.mcpSecret.trim()

    if (!mcpUrl || !mcpSecret) {
      addToast('error', 'Enter MCP URL and MCP secret first')
      return
    }

    setIsTestingMcp(true)
    try {
      const data = await requestJson<McpTestResponse>(`${API_BASE_URL}/mcp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mcpUrl, secret: mcpSecret }),
      })

      addToast('success', `MCP connected (${data.toolCount} tool${data.toolCount === 1 ? '' : 's'})`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'MCP test failed'
      addToast('error', `MCP test failed: ${message}`)
    } finally {
      setIsTestingMcp(false)
    }
  }

  async function handleToggleKnowledge(agent: Agent, nextValue: boolean) {
    try {
      await requestJson(`${API_BASE_URL}/agents/${agent.id}/knowledge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasKnowledge: nextValue }),
      })

      setAgents((prev) =>
        prev.map((item) => (item.id === agent.id ? { ...item, hasKnowledge: nextValue } : item))
      )
      addToast('success', `${agent.name}: knowledge ${nextValue ? 'enabled' : 'disabled'}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update agent knowledge'
      addToast('error', message)
    }
  }

  function openChat(agent: Agent) {
    setChatAgent(agent)
    setChatInput('')
    setChatUseKnowledge(agent.knowledgeOnly ? true : agent.hasKnowledge)
    setChatHistory([])
    setFeedbackLoadingIds([])
  }

  async function submitChatFeedback(turnId: string, score: 0 | 1) {
    if (!chatAgent) {
      return
    }

    const turn = chatHistory.find((item) => item.id === turnId)
    if (!turn?.traceId) {
      addToast('error', 'No trace ID found for this response')
      return
    }

    setFeedbackLoadingIds((prev) => [...prev, turnId])
    try {
      await requestJson<{ ok: boolean }>(`${API_BASE_URL}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traceId: turn.traceId,
          agentId: chatAgent.id,
          score,
        }),
      })

      setChatHistory((prev) =>
        prev.map((item) =>
          item.id === turnId
            ? {
                ...item,
                feedbackSubmitted: true,
              }
            : item
        )
      )
      addToast('success', 'Feedback saved')
      loadFeedbackMetrics().catch(() => {
        /* optional refresh */
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to submit feedback'
      addToast('error', message)
    } finally {
      setFeedbackLoadingIds((prev) => prev.filter((id) => id !== turnId))
    }
  }

  async function handleChatSend(event: FormEvent) {
    event.preventDefault()

    if (!chatAgent || !chatInput.trim()) {
      return
    }

    const question = chatInput.trim()
    setChatInput('')
    setIsChatting(true)
    setChatHistory((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: question }])

    try {
      const data = await requestJson<ChatApiResponse>(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: chatAgent.id,
          message: question,
          useKnowledge: chatAgent.knowledgeOnly ? true : chatUseKnowledge,
          topK: 3,
        }),
      })

      setChatHistory((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: chatText(data.response),
          meta: `${data.provider} | ${data.retrievedChunkCount} chunks${
            data.delegation?.selectedChildAgentName
              ? ` | delegated: ${data.delegation.selectedChildAgentName}`
              : data.delegation?.attempted
                ? ' | parent-only'
                : ''
          }`,
          traceId: data.traceId ?? undefined,
          feedbackSubmitted: false,
        },
      ])

      if (data.mcpInvocation?.attempted && !data.mcpInvocation.success) {
        addToast('error', `MCP failed: ${data.mcpInvocation.error ?? 'unknown error'}`)
      }

      if (data.delegation?.attempted && !data.delegation.success) {
        addToast('error', `Child delegation failed: ${data.delegation.error ?? 'unknown error'}`)
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Chat failed'
      addToast('error', message)
    } finally {
      setIsChatting(false)
    }
  }

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [agents]
  )

  const filteredAgents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) {
      return sortedAgents
    }

    return sortedAgents.filter((agent) => {
      const searchableText = [
        agent.name,
        agent.description,
        agent.goal,
        agent.systemPrompt,
        agent.childAgents.map((child) => child.name).join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }, [searchTerm, sortedAgents])

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <p className="kicker">Agent Hub MVP</p>
        <div className="hero-row">
          <div>
            <h1>Agents Workspace</h1>
            <p>Browse agents, start chat instantly, or add a new agent with attached knowledge files.</p>
          </div>
          <div className="hero-actions">
            <button
              className="secondary-btn"
              onClick={() => {
                loadFeedbackMetrics().catch((error: unknown) => {
                  const message =
                    error instanceof Error ? error.message : 'Failed to load feedback metrics'
                  addToast('error', message)
                })
                setIsFeedbackOpen(true)
              }}
            >
              Agent Feedback
            </button>
            <button
              className="add-agent-btn"
              onClick={() => {
                resetCreateModal()
                setIsCreateOpen(true)
              }}
            >
              Add Agent
            </button>
          </div>
        </div>
        <div className="search-row">
          <div className="search-input-wrap">
            <input
              ref={searchInputRef}
              placeholder="Search agents by name, goal, or prompt"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {searchTerm && (
              <button type="button" className="search-clear-btn" onClick={() => setSearchTerm('')}>
                Clear
              </button>
            )}
          </div>
          <p className="search-count">
            Showing {filteredAgents.length} of {sortedAgents.length} agents
          </p>
        </div>
      </header>

      <section className="agents-grid">
        {hasAgents && filteredAgents.length > 0 ? (
          filteredAgents.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-top">
                <h2>{agent.name}</h2>
                <button className="chat-icon-btn" onClick={() => openChat(agent)} title="Chat with agent">
                  Chat
                </button>
              </div>
              <p className="agent-description">{agent.description}</p>
              <p>
                <strong>Goal:</strong> {agent.goal}
              </p>
              <div className="chips">
                <span className="chip">{agent.outputMode}</span>
                <span className="chip">{agent.knowledgeOnly ? 'files only' : 'mixed mode'}</span>
                <span className="chip">{agent.internetEnabled ? 'internet on' : 'internet off'}</span>
                <span className="chip">{agent.mcpEnabled ? 'mcp enabled' : 'mcp off'}</span>
                <span className="chip">children: {agent.childAgents.length}</span>
              </div>
              {agent.childAgents.length > 0 && (
                <p className="hint">
                  Child agents: {agent.childAgents.map((child) => child.name).join(', ')}
                </p>
              )}
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={agent.knowledgeOnly ? true : agent.hasKnowledge}
                  disabled={agent.knowledgeOnly}
                  onChange={(event) => handleToggleKnowledge(agent, event.target.checked)}
                />
                <span>
                  {agent.knowledgeOnly ? 'Knowledge always on (files-only mode)' : 'Use knowledge in chat'}
                </span>
              </label>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <p>
              {hasAgents
                ? `No agents match "${searchTerm}".`
                : 'No agents yet. Click Add Agent to create your first one.'}
            </p>
          </div>
        )}
      </section>

      {isCreateOpen && (
        <div className="modal-backdrop">
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Create Agent</h3>
              <button className="icon-close" onClick={() => setIsCreateOpen(false)}>
                x
              </button>
            </div>

            <form className="stack" onSubmit={handleGenerateSkillDraft}>
              <input
                placeholder="Agent name"
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              />
              <textarea
                placeholder="Description"
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, description: event.target.value }))
                }
              />
              <textarea
                placeholder="Goal"
                value={createForm.goal}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, goal: event.target.value }))}
              />
              <div className="row">
                <select
                  value={createForm.outputMode}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      outputMode: event.target.value as AgentOutputMode,
                    }))
                  }
                >
                  <option value="text">text</option>
                  <option value="json">json</option>
                </select>
                <button type="submit" disabled={isDrafting}>
                  {isDrafting ? 'Generating...' : 'Generate Prompt'}
                </button>
              </div>
            </form>

            <form className="stack" onSubmit={handleCreateAgent}>
              <textarea
                placeholder="System prompt"
                value={createForm.systemPrompt}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, systemPrompt: event.target.value }))
                }
              />
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={createForm.hasKnowledge}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, hasKnowledge: event.target.checked }))
                  }
                />
                <span>Start with knowledge enabled</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={createForm.knowledgeOnly}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, knowledgeOnly: event.target.checked }))
                  }
                />
                <span>Use attached files only for answers</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={!createForm.internetEnabled}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, internetEnabled: !event.target.checked }))
                  }
                />
                <span>Disable internet browsing</span>
              </label>
              <label>
                Attach knowledge files (txt, md, csv, json, pdf)
                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    handleKnowledgeFileSelection(event.target.files).catch((error: unknown) => {
                      const message =
                        error instanceof Error ? error.message : 'Failed to read selected files'
                      addToast('error', message)
                    })
                  }}
                />
              </label>
              {knowledgeFiles.length > 0 && (
                <p className="hint">{knowledgeFiles.length} file(s) attached for knowledge base</p>
              )}

              <section className="child-agents-box">
                <p className="hint"><strong>Child agents (optional)</strong> — parent may delegate to one per turn.</p>
                {agents.length === 0 ? (
                  <p className="hint">No existing agents available for child delegation.</p>
                ) : (
                  <div className="child-agents-list">
                    {agents.map((agent) => (
                      <label className="toggle-row" key={`child-${agent.id}`}>
                        <input
                          type="checkbox"
                          checked={createForm.childAgentIds.includes(agent.id)}
                          onChange={(event) => {
                            const checked = event.target.checked
                            setCreateForm((prev) => ({
                              ...prev,
                              childAgentIds: checked
                                ? [...prev.childAgentIds, agent.id]
                                : prev.childAgentIds.filter((id) => id !== agent.id),
                            }))
                          }}
                        />
                        <span>{agent.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={createForm.mcpEnabled}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, mcpEnabled: event.target.checked }))
                  }
                />
                <span>Enable MCP for this agent</span>
              </label>

              {createForm.mcpEnabled && (
                <>
                  <label>
                    MCP URL
                    <input
                      placeholder="MCP URL"
                      value={createForm.mcpUrl}
                      onChange={(event) =>
                        setCreateForm((prev) => ({ ...prev, mcpUrl: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    MCP Secret
                    <input
                      type="password"
                      placeholder="MCP secret"
                      value={createForm.mcpSecret}
                      onChange={(event) =>
                        setCreateForm((prev) => ({ ...prev, mcpSecret: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      handleTestMcpConnection().catch(() => {
                        /* handled in function */
                      })
                    }}
                    disabled={isTestingMcp}
                  >
                    {isTestingMcp ? 'Testing MCP...' : 'Test MCP Connection'}
                  </button>
                </>
              )}

              {skillDraft && (
                <div className="draft-box">
                  <p>{skillDraft.constraints[0]}</p>
                  <p>{skillDraft.examplePrompts[0]}</p>
                </div>
              )}
              <button type="submit" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Agent'}
              </button>
            </form>

            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setIsCreateOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {isFeedbackOpen && (
        <div className="modal-backdrop">
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Agent Feedback (30d)</h3>
              <button className="icon-close" onClick={() => setIsFeedbackOpen(false)}>
                x
              </button>
            </div>

            <section className="feedback-board in-modal">
              <div className="feedback-board-head">
                <p className="hint">Use thumbs in chat to generate comparable agent scores.</p>
                <button
                  type="button"
                  className="chat-icon-btn"
                  onClick={() => {
                    loadFeedbackMetrics().catch((error: unknown) => {
                      const message =
                        error instanceof Error ? error.message : 'Failed to load feedback metrics'
                      addToast('error', message)
                    })
                  }}
                >
                  Refresh
                </button>
              </div>
              {feedbackMetrics.length === 0 ? (
                <p className="hint">No feedback scores yet. Submit thumbs in chat to populate this table.</p>
              ) : (
                <div className="feedback-table-wrap">
                  <table className="feedback-table">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Positive Rate</th>
                        <th>Votes</th>
                        <th>Up</th>
                        <th>Down</th>
                        <th>Judge Avg</th>
                        <th>Judge Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feedbackMetrics.map((metric) => (
                        <tr key={metric.agentId}>
                          <td>{metric.agentName}</td>
                          <td>
                            {metric.positiveRate === null
                              ? '-'
                              : `${Math.round(metric.positiveRate * 100)}%`}
                          </td>
                          <td>{metric.votes}</td>
                          <td>{metric.positiveVotes}</td>
                          <td>{metric.negativeVotes}</td>
                          <td>{metric.judgeAvg === null ? '-' : `${Math.round(metric.judgeAvg * 100)}%`}</td>
                          <td>{metric.judgeCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setIsFeedbackOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {chatAgent && (
        <div className="modal-backdrop">
          <section className="modal chat-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Chat: {chatAgent.name}</h3>
              <button className="icon-close" onClick={() => setChatAgent(null)}>
                x
              </button>
            </div>
            <p className="hint">{chatAgent.goal}</p>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={chatAgent.knowledgeOnly ? true : chatUseKnowledge}
                disabled={chatAgent.knowledgeOnly}
                onChange={(event) => setChatUseKnowledge(event.target.checked)}
              />
              <span>
                {chatAgent.knowledgeOnly ? 'Files-only mode enforced' : 'Use knowledge for this chat'}
              </span>
            </label>

            <div className="chat-log" ref={chatLogRef}>
              {chatHistory.length === 0 ? (
                <p className="hint">Start by asking a question.</p>
              ) : (
                <>
                  {chatHistory.map((turn) => (
                    <article className={`chat-bubble ${turn.role}`} key={turn.id}>
                      <p>{turn.text}</p>
                      {turn.meta && <small>{turn.meta}</small>}
                      {turn.role === 'assistant' && (
                        <div className="feedback-row">
                          <button
                            type="button"
                            className="feedback-btn"
                            disabled={
                              !turn.traceId ||
                              Boolean(turn.feedbackSubmitted) ||
                              feedbackLoadingIds.includes(turn.id)
                            }
                            onClick={() => {
                              submitChatFeedback(turn.id, 1).catch(() => {
                                /* handled in function */
                              })
                            }}
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            className="feedback-btn"
                            disabled={
                              !turn.traceId ||
                              Boolean(turn.feedbackSubmitted) ||
                              feedbackLoadingIds.includes(turn.id)
                            }
                            onClick={() => {
                              submitChatFeedback(turn.id, 0).catch(() => {
                                /* handled in function */
                              })
                            }}
                          >
                            👎
                          </button>
                          {turn.feedbackSubmitted && <small className="feedback-saved">feedback saved</small>}
                        </div>
                      )}
                    </article>
                  ))}
                  {isChatting && (
                    <article className="chat-bubble assistant working">
                      <p className="working-label">Thinking...</p>
                      <div className="working-dots" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </article>
                  )}
                </>
              )}
            </div>

            <form className="chat-form" onSubmit={handleChatSend}>
              <textarea
                placeholder="Ask agent"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
              />
              <button type="submit" disabled={isChatting || !chatInput.trim()}>
                {isChatting ? 'Sending...' : 'Send'}
              </button>
            </form>

            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setChatAgent(null)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="toast-stack">
        {toasts.map((toast) => (
          <article className={`toast ${toast.kind}`} key={toast.id}>
            <p>{toast.message}</p>
            <button onClick={() => dismissToast(toast.id)}>x</button>
          </article>
        ))}
      </section>
    </main>
  )
}

export default App
